#!/usr/bin/env node
/*
 * audit-release.mjs - local release-audit for SourceCapsule exports.
 *
 * Usage:
 *   node scripts/audit-release.mjs <exportsDir> [--json <path>] > release-audit-report.md
 *
 * Scans a folder for matching export sets (<name>.html + <name>.llm.md), audits each
 * for offline-media honesty, and prints a compact Markdown report to stdout. Optionally
 * writes a machine-readable release-audit.json.
 *
 * Honesty is the whole point. The embedded `script#sourcecapsule-debug` JSON manifest is
 * the authoritative, base64-free record, but this auditor does NOT trust its self-labels:
 * it re-derives each video's preservation mode from evidence and cross-checks the manifest
 * against the visible HTML body and the LLM Markdown wording. A video counts as captured
 * ONLY when an actual offline `data:video` asset with byte size / hash is present.
 *
 * The report never contains base64 or large embedded payloads.
 */

import fs from 'node:fs';
import path from 'node:path';

const RELEASE_VERSION = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function discoverSets(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const sets = new Map();
  const keyFor = (name, suffix) => name.slice(0, name.length - suffix.length);
  for (const e of entries) {
    if (!e.isFile()) continue;
    const name = e.name;
    if (name.endsWith('.llm.md')) {
      const key = keyFor(name, '.llm.md');
      const s = sets.get(key) || { name: key };
      s.md = path.join(dir, name);
      sets.set(key, s);
    } else if (name.endsWith('.html')) {
      const key = keyFor(name, '.html');
      const s = sets.get(key) || { name: key };
      s.html = path.join(dir, name);
      sets.set(key, s);
    }
  }
  return [...sets.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const countMatches = (str, re) => {
  let n = 0;
  re.lastIndex = 0;
  while (re.exec(str) !== null) n += 1;
  return n;
};
const fmtBytes = (n) => {
  if (!Number.isFinite(n)) return String(n);
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const yn = (b) => (b ? 'yes' : 'no');

// ---------------------------------------------------------------------------
// HTML parsing (manifest + lightweight body cross-checks)
// ---------------------------------------------------------------------------

function extractDebugManifest(html) {
  // sourcecapsule-debug is the current id; the contextvault-debug and exportarticle-debug
  // ids are kept so archives made under the project's earlier names still audit.
  let idx = html.indexOf('id="sourcecapsule-debug"');
  if (idx < 0) idx = html.indexOf('id="contextvault-debug"');
  if (idx < 0) idx = html.indexOf('id="exportarticle-debug"');
  if (idx < 0) return null;
  const gt = html.indexOf('>', idx);
  const end = html.indexOf('</script>', gt);
  if (gt < 0 || end < 0) return null;
  const json = html.slice(gt + 1, end).trim();
  try {
    return JSON.parse(json);
  } catch {
    return { _parseError: true };
  }
}

function auditHtml(file) {
  const size = fs.statSync(file).size;
  const html = fs.readFileSync(file, 'utf8');
  const manifest = extractDebugManifest(html);

  const firstAttr = (re) => {
    const m = html.match(re);
    return m ? m[1].trim() : '';
  };
  const lang = firstAttr(/<html[^>]*\blang="([^"]*)"/i);
  const title = firstAttr(/<title>([\s\S]*?)<\/title>/i);

  // Actual embedded video asset sizes (decoded bytes). This is the ground truth that the
  // manifest's videoFileSize claims are checked against - a fake fragment cannot hide here.
  const videoAssetBytes = [];
  const dvRe = /data:video\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)/g;
  let dv;
  while ((dv = dvRe.exec(html)) !== null) {
    const b64 = dv[1];
    const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    videoAssetBytes.push(Math.floor((b64.length * 3) / 4) - pad);
  }

  // Body cross-check counts (single-pass scans; small result sets).
  const body = {
    offlineFigures: countMatches(html, /class="xa-video"/g),
    fallbackFigures: countMatches(html, /class="xa-video-fallback"/g),
    dataVideo: countMatches(html, /data:video\//g),
    dataImage: countMatches(html, /data:image\//g),
    preservedOfflineCaptions: countMatches(html, /preserved offline<\/figcaption>/g),
    fallbackCaptions: countMatches(html, /not preserved offline[^<]*<\/figcaption>/g),
    sourceElements: countMatches(html, /<source\b/gi),
    videoElements: countMatches(html, /<video\b/gi),
    timeElements: countMatches(html, /<time\b/gi),
    h1: countMatches(html, /<h1\b/gi),
    h2: countMatches(html, /<h2\b/gi),
    h3: countMatches(html, /<h3\b/gi),
    h4: countMatches(html, /<h4\b/gi),
    paragraphs: countMatches(html, /<p\b/gi),
    lists: countMatches(html, /<(ul|ol)\b/gi),
    listItems: countMatches(html, /<li\b/gi),
    quoteCards: countMatches(html, /class="[^"]*xa-tweet-card/g),
    nestedQuoteCards: countMatches(html, /xa-nested-tweet-card/g),
    missingBlocks: countMatches(html, /class="[^"]*xa-missing/g),
    imgSha: countMatches(html, /data-xa-sha256=/g),
    imgMediaId: countMatches(html, /data-xa-media-id=/g),
    disclaimer: html.includes('xa-disclaimer'),
  };

  // External-link safety: every http(s) anchor must carry target + rel.
  const anchorRe = /<a\b[^>]*\bhref="(https?:[^"]*)"[^>]*>/gi;
  let badLinks = 0;
  let externalLinks = 0;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    externalLinks += 1;
    const tag = m[0];
    if (!/\btarget=/i.test(tag) || !/\brel=/i.test(tag)) badLinks += 1;
  }

  return { file, size, lang, title, manifest, body, videoAssetBytes, externalLinks, badLinks };
}

// Minimum plausible size for a real, playable MP4. Below this we treat a "preserved
// offline" claim as a suspected fake fragment (the v0.4.2 failure mode).
const MIN_PLAUSIBLE_VIDEO_BYTES = 50 * 1024;

// ---------------------------------------------------------------------------
// Video classification - re-derived from EVIDENCE, not the manifest's label.
// ---------------------------------------------------------------------------

function classifyVideoEvidence(r) {
  const hasBytes = !!(r.videoFileSha256 || r.videoFileSize);
  if (r.offlinePlayable && hasBytes) return 'offline-video';
  if (r.offlinePlayable && !hasBytes) return 'offline-unverified'; // claims offline w/o bytes
  if (r.posterCaptured && r.sourceLinkPreserved) return 'poster-only';
  if (r.unsupported) return 'unsupported';
  const fr = r.failureReason || '';
  if (fr === 'video_download_failed' || (r.discoveredVideoUrls && r.discoveredVideoUrls.length))
    return 'download-failed';
  return 'discovery-failed';
}

// ---------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------

function section(md, heading) {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*$`, 'm');
  const m = md.match(re);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = md.slice(start);
  const next = rest.search(/^##\s+/m);
  return next < 0 ? rest : rest.slice(0, next);
}

function auditMarkdown(file) {
  const size = fs.statSync(file).size;
  const md = fs.readFileSync(file, 'utf8');
  const head = (label) => {
    const m = md.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  const sections = {
    captureSummary: /^##\s+Capture Summary\s*$/m.test(md),
    mainArticle: /^##\s+Main Article\s*$/m.test(md),
    embeddedPosts: /^##\s+Embedded \/ Quoted Posts\s*$/m.test(md),
    duplicateMedia: /^##\s+Duplicate Media\s*$/m.test(md),
    mediaReferences: /^##\s+Media References\s*$/m.test(md),
    missingIncomplete: /^##\s+Missing \/ Incomplete Content\s*$/m.test(md),
    sourceLinks: /^##\s+Source Links\s*$/m.test(md),
  };
  const leakage = {
    base64: /;base64,/.test(md),
    dataImage: /data:image\//.test(md),
    dataVideo: /data:video\//.test(md),
    style: /<style\b/i.test(md),
    script: /<script\b/i.test(md),
  };
  const srcSection = section(md, 'Source Links') || '';
  const sourceLinks = (srcSection.match(/^\d+\.\s+(\S+)/gm) || []).map((l) =>
    l.replace(/^\d+\.\s+/, '').trim()
  );
  const emptySourceLinks = sourceLinks.filter((l) => !/^https?:\/\/\S+/.test(l)).length;

  // Possibly-truncated quoted posts that are explicitly marked.
  const truncationMarks = countMatches(md, /Text status:\s*possibly truncated/g);

  // Misleading "preserved" wording on poster-only videos: a [Video ...] / [Missing video ...]
  // inline reference, or a media-reference block, that says preserved while not offline.
  const misleadingLines = [];
  const inlineVideoRe = /\[(?:Missing video|Video):[^\]]*\]/g;
  let vm;
  while ((vm = inlineVideoRe.exec(md)) !== null) {
    const line = vm[0];
    if (/preserved offline in archive\.html/.test(line) && /not preserved offline/.test(line)) {
      // honest dual mention is impossible; skip
    }
  }

  return {
    file,
    size,
    md,
    head,
    sections,
    leakage,
    sourceLinks,
    emptySourceLinks,
    truncationMarks,
    misleadingLines,
  };
}

// ---------------------------------------------------------------------------
// Per-set audit
// ---------------------------------------------------------------------------

function auditSet(set) {
  const result = { name: set.name, blockers: [], shouldFix: [], niceToHave: [] };
  result.hasHtml = !!set.html;
  result.hasMd = !!set.md;
  if (!set.html) result.blockers.push('HTML export missing from set.');
  if (!set.md) result.blockers.push('LLM Markdown (.llm.md) missing from set.');

  const h = set.html ? auditHtml(set.html) : null;
  const md = set.md ? auditMarkdown(set.md) : null;
  result.html = h;
  result.md = md;

  // ---- HTML manifest analysis ----
  let cap = null;
  let videos = [];
  if (h && h.manifest && !h.manifest._parseError) {
    const man = h.manifest;
    cap = man.capture || {};
    result.exporterVersion = (man.exporter && man.exporter.version) || '';
    const mediaArr = Array.isArray(man.media) ? man.media : [];
    const imageMedia = mediaArr.filter((x) => x.type === 'image');
    const videoMedia = mediaArr.filter((x) => x.type === 'video');
    videos = videoMedia.map((r) => ({
      id: r.id,
      claimed: r.mode,
      evidence: classifyVideoEvidence(r),
      rec: r,
    }));

    // Match each offline-claimed video to an actual embedded asset by its claimed byte size,
    // proving the bytes really exist and are substantial (not a fragment).
    const poolBytes = [...h.videoAssetBytes];
    result.videoEvidence = videos.map((v) => {
      const claimedSize = Number(v.rec.videoFileSize) || 0;
      let matchedBytes = null;
      if (v.rec.offlinePlayable && poolBytes.length) {
        // find closest asset (allow small rounding/whitespace differences)
        let bestIdx = -1;
        let bestDiff = Infinity;
        for (let i = 0; i < poolBytes.length; i++) {
          const diff = Math.abs(poolBytes[i] - claimedSize);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        }
        if (bestIdx >= 0 && (claimedSize === 0 || bestDiff <= Math.max(1024, claimedSize * 0.02))) {
          matchedBytes = poolBytes[bestIdx];
          poolBytes.splice(bestIdx, 1);
        }
      }
      return {
        id: v.id,
        claimed: v.claimed,
        evidence: v.evidence,
        claimedSize,
        embeddedBytes: matchedBytes,
        durationSeconds: v.rec.durationSeconds || null,
        sha256: v.rec.videoFileSha256 || '',
        mime: v.rec.videoFileMime || '',
        posterCaptured: !!v.rec.posterCaptured,
        sourceLinkPreserved: !!v.rec.sourceLinkPreserved,
        failureReason: v.rec.failureReason || '',
      };
    });

    result.images = {
      total: imageMedia.length,
      withDims: imageMedia.filter((x) => x.width && x.height).length,
      withSha: imageMedia.filter((x) => x.sha256).length,
      nonGenericAlt: imageMedia.filter((x) => x.alt && !/^image$/i.test(String(x.alt).trim()))
        .length,
      missing: imageMedia.filter((x) => x.missing).length,
    };

    const byMode = (mode) => videos.filter((v) => v.evidence === mode).length;
    result.videoModes = {
      total: videos.length,
      offline: byMode('offline-video'),
      offlineUnverified: byMode('offline-unverified'),
      posterOnly: byMode('poster-only'),
      downloadFailed: byMode('download-failed'),
      discoveryFailed: byMode('discovery-failed'),
      unsupported: byMode('unsupported'),
    };
    result.incompleteVideos =
      result.videoModes.posterOnly +
      result.videoModes.downloadFailed +
      result.videoModes.discoveryFailed +
      result.videoModes.unsupported +
      result.videoModes.offlineUnverified;

    result.manifestCapture = {
      mainTextCaptured: !!cap.mainTextCaptured,
      quoteCards: cap.quoteCards || 0,
      images: cap.images || 0,
      videos: cap.videos || 0,
      videosPreservedOffline: cap.videosPreservedOffline || 0,
      videoPostersCaptured: cap.videoPostersCaptured || 0,
      videoSourceLinksPreserved: cap.videoSourceLinksPreserved || 0,
      incompleteMedia: cap.incompleteMedia || 0,
      missingMedia: cap.missingMedia || 0,
      hashedMedia: cap.hashedMedia || 0,
      duplicateMedia: cap.duplicateMedia || 0,
      sourceLinks: cap.sourceLinks || 0,
    };
    result.warnings = Array.isArray(man.warnings) ? man.warnings : [];
    result.missing = Array.isArray(man.missing) ? man.missing : [];
    result.incomplete = Array.isArray(man.incomplete) ? man.incomplete : [];
    result.duplicates = Array.isArray(man.duplicates) ? man.duplicates : [];

    // ---- BLOCKER CHECKS (HTML) ----

    // #5 manifest contradicts evidence: claims offline-video without actual bytes.
    for (const v of videos) {
      if (v.claimed === 'offline-video' && v.evidence !== 'offline-video') {
        result.blockers.push(
          `Manifest video ${v.id || '(no id)'} is labelled mode "offline-video" but has no embedded bytes/hash (evidence: ${v.evidence}).`
        );
      }
    }

    // #1/#2/#5 per-video byte proof: an offline-classified video must have a real, matched,
    // substantial embedded asset behind it. Fragments and unbacked claims are blockers.
    for (const ev of result.videoEvidence || []) {
      if (ev.evidence !== 'offline-video') continue;
      if (ev.embeddedBytes === null) {
        result.blockers.push(
          `Video ${ev.id || '(no id)'} is labelled preserved offline (${fmtBytes(ev.claimedSize)} claimed) but no matching embedded data:video asset was found in the HTML body.`
        );
      } else if (ev.embeddedBytes < MIN_PLAUSIBLE_VIDEO_BYTES) {
        result.blockers.push(
          `Video ${ev.id || '(no id)'} claims preserved offline but the embedded asset is only ${fmtBytes(ev.embeddedBytes)} - suspected fake/fragment, not a playable video.`
        );
      }
    }

    // #1/#5 aggregate: manifest claims N preserved offline but the body has fewer data:video assets.
    const claimedOffline = result.manifestCapture.videosPreservedOffline;
    if (claimedOffline > h.body.dataVideo) {
      result.blockers.push(
        `Manifest claims ${claimedOffline} video(s) preserved offline, but the HTML body contains only ${h.body.dataVideo} data:video asset(s).`
      );
    }
    // evidence-derived offline count must be backed by real assets too.
    if (result.videoModes.offline > h.body.dataVideo) {
      result.blockers.push(
        `${result.videoModes.offline} video(s) classified offline-video, but only ${h.body.dataVideo} data:video asset(s) embedded.`
      );
    }

    // #2 HTML caption says "preserved offline" without a data:video asset behind it.
    if (h.body.preservedOfflineCaptions > h.body.dataVideo) {
      result.blockers.push(
        `HTML shows ${h.body.preservedOfflineCaptions} "preserved offline" caption(s) but only ${h.body.dataVideo} data:video asset(s) exist.`
      );
    }
    if (h.body.offlineFigures !== h.body.dataVideo) {
      result.shouldFix.push(
        `xa-video figure count (${h.body.offlineFigures}) != data:video asset count (${h.body.dataVideo}).`
      );
    }

    // #4 poster-only / incomplete videos must be accounted in manifest incomplete[].
    if (result.incompleteVideos > 0 && result.incomplete.length === 0) {
      result.blockers.push(
        `${result.incompleteVideos} incomplete video(s) detected but manifest incomplete[] is empty.`
      );
    }
  } else if (h) {
    result.blockers.push(
      'HTML debug manifest (script#sourcecapsule-debug) missing or unparseable.'
    );
  }

  // #6 provenance
  if (h && h.manifest && !h.manifest._parseError) {
    const man = h.manifest;
    const c = man.capture || {};
    const missingProvenance = [];
    if (!c.sourceUrl) missingProvenance.push('source URL');
    if (!c.exportedAt) missingProvenance.push('export timestamp');
    if (!(man.exporter && man.exporter.version)) missingProvenance.push('exporter version');
    if (!h.body.disclaimer) missingProvenance.push('capture disclaimer');
    if (missingProvenance.length)
      result.blockers.push(`Missing provenance in HTML: ${missingProvenance.join(', ')}.`);
    if (!c.publishedAt) result.niceToHave.push('Published timestamp not available in HTML.');
  }

  // External-link safety (HTML).
  if (h && h.badLinks > 0)
    result.shouldFix.push(`${h.badLinks} external link(s) missing target/rel in HTML.`);

  // ---- Markdown blocker checks ----
  if (md) {
    // #7 leakage
    const leaks = Object.entries(md.leakage)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (leaks.length)
      result.blockers.push(`LLM Markdown contains forbidden payload: ${leaks.join(', ')}.`);

    // #3 misleading "preserved" wording on poster-only videos, verified against manifest.
    if (videos.length) {
      for (const v of videos) {
        if (v.evidence === 'offline-video') continue;
        const id = v.id;
        if (!id) continue;
        // any line mentioning this video id that asserts offline preservation
        const idRe = new RegExp(`^.*${id.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}.*$`, 'gm');
        const lines = md.md.match(idRe) || [];
        for (const line of lines) {
          if (
            /preserved offline in archive\.html/.test(line) ||
            /poster\/link preserved in archive\.html/.test(line) ||
            /Mode:\s*offline-video/.test(line)
          ) {
            result.blockers.push(
              `LLM Markdown claims preservation for non-offline video ${id}: "${line.trim().slice(0, 120)}"`
            );
          }
        }
      }
    }

    // #4 incomplete videos must appear in the Missing / Incomplete section.
    const missSection = section(md.md, 'Missing / Incomplete Content') || '';
    if (videos.length) {
      for (const v of videos) {
        if (v.evidence === 'offline-video') continue;
        if (v.id && !missSection.includes(v.id)) {
          result.shouldFix.push(
            `Incomplete video ${v.id} not listed in Markdown "Missing / Incomplete Content".`
          );
        }
      }
    }

    // sections present
    const missingSecs = Object.entries(md.sections)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    // CaptureSummary / MainArticle / SourceLinks are mandatory; others are conditional.
    for (const key of ['captureSummary', 'mainArticle', 'sourceLinks']) {
      if (!md.sections[key]) result.shouldFix.push(`Markdown missing mandatory section: ${key}.`);
    }
    result.mdMissingSections = missingSecs;

    if (md.emptySourceLinks > 0)
      result.shouldFix.push(`${md.emptySourceLinks} empty/broken source link(s) in Markdown.`);

    // provenance in markdown head
    for (const f of ['Source', 'Exported at', 'Exporter']) {
      if (!md.head(f)) result.shouldFix.push(`Markdown header missing "${f}".`);
    }
  }

  // ---- cross-file accounting: HTML manifest vs Markdown ----
  if (md && h && h.manifest && !h.manifest._parseError && md.sections.captureSummary) {
    const mdSummary = section(md.md, 'Capture Summary') || '';
    const grab = (label) => {
      const m = mdSummary.match(new RegExp(`${label}:\\s*([0-9]+)`));
      return m ? Number(m[1]) : null;
    };
    const mdPreserved = grab('Videos preserved offline');
    if (mdPreserved !== null && mdPreserved !== result.videoModes.offline) {
      result.shouldFix.push(
        `Markdown says ${mdPreserved} videos preserved offline; HTML evidence shows ${result.videoModes.offline}.`
      );
    }
  }

  result.verdict = result.blockers.length
    ? 'BLOCKED'
    : result.shouldFix.length
      ? 'PASS WITH FIXES'
      : 'PASS';
  return result;
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderReport(results) {
  const L = [];
  const anyBlocked = results.some((r) => r.blockers.length);
  const anyFixes = results.some((r) => r.shouldFix.length);
  const overall = anyBlocked ? 'BLOCKED' : anyFixes ? 'PASS WITH FIXES' : 'PASS';

  L.push('# SourceCapsule Public Release Audit');
  L.push('');
  L.push(`Generated: ${new Date().toISOString()}`);
  L.push(`Export sets audited: ${results.length}`);
  L.push('');
  L.push('## Overall Verdict');
  L.push('');
  L.push(`Status: ${overall}`);
  L.push('');
  L.push('> Scope: this audit reasons only from the exported files. It proves that every video');
  L.push(
    '> *labelled* preserved is backed by a real, byte-matched offline asset, and that fallback'
  );
  L.push('> states are reported honestly. It CANNOT detect a video that X showed but the exporter');
  L.push(
    '> never captured into the model (a silent omission) - that requires comparing against the'
  );
  L.push('> live page at export time. Sets reporting 0 videos are taken at face value.');
  L.push('');

  L.push('## Blockers');
  L.push('');
  const allBlockers = [];
  for (const r of results) for (const b of r.blockers) allBlockers.push(`**${r.name}** - ${b}`);
  if (!allBlockers.length) L.push('_None._');
  else allBlockers.forEach((b, i) => L.push(`${i + 1}. ${b}`));
  L.push('');

  // Summary table
  L.push('## Summary Table');
  L.push('');
  L.push(
    '| Set | HTML | LLM MD | Images | Videos offline | Videos incomplete | Missing media | Verdict |'
  );
  L.push('|---|---:|---:|---:|---:|---:|---:|---|');
  for (const r of results) {
    const vm = r.videoModes || {};
    L.push(
      `| ${r.name} | ${r.hasHtml ? 'yes' : 'MISSING'} | ${r.hasMd ? 'yes' : 'MISSING'} | ${
        r.images ? r.images.total : '-'
      } | ${vm.offline ?? '-'} | ${r.incompleteVideos ?? '-'} | ${
        r.manifestCapture ? r.manifestCapture.missingMedia : '-'
      } | ${r.verdict} |`
    );
  }
  L.push('');

  // Per-set detail
  for (const r of results) {
    L.push(`## Set: ${r.name}`);
    L.push('');
    // HTML
    L.push('### HTML');
    L.push('');
    if (!r.html) {
      L.push('- File: **MISSING**');
    } else {
      const h = r.html;
      const c = r.manifestCapture || {};
      L.push(`- File: \`${path.basename(h.file)}\``);
      L.push(`- File size: ${fmtBytes(h.size)}`);
      L.push(`- Exporter version: ${r.exporterVersion || '(unknown)'}`);
      L.push(`- Document language: ${h.lang || '(none)'}`);
      L.push(`- Title: ${h.title || '(none)'}`);
      L.push(
        `- Source URL: ${(h.manifest && h.manifest.capture && h.manifest.capture.sourceUrl) || '(none)'}`
      );
      L.push(
        `- Published at: ${(h.manifest && h.manifest.capture && h.manifest.capture.publishedAt) || '(none)'}`
      );
      L.push(
        `- Exported at: ${(h.manifest && h.manifest.capture && h.manifest.capture.exportedAt) || '(none)'}`
      );
      L.push(`- Capture disclaimer present: ${yn(h.body.disclaimer)}`);
      L.push(`- Debug manifest present: ${yn(!!(h.manifest && !h.manifest._parseError))}`);
      L.push('');
      L.push('Capture summary (from manifest):');
      L.push(`  - Main text: ${c.mainTextCaptured ? 'captured' : 'NOT detected'}`);
      L.push(`  - Embedded posts: ${c.quoteCards ?? '-'}`);
      L.push(`  - Images: ${c.images ?? '-'}`);
      L.push(`  - Videos found: ${c.videos ?? '-'}`);
      L.push(`  - Videos preserved offline (manifest): ${c.videosPreservedOffline ?? '-'}`);
      L.push(`  - Video posters captured: ${c.videoPostersCaptured ?? '-'}`);
      L.push(`  - Video source links preserved: ${c.videoSourceLinksPreserved ?? '-'}`);
      L.push(`  - Incomplete media: ${c.incompleteMedia ?? '-'}`);
      L.push(`  - Hashed media: ${c.hashedMedia ?? '-'}`);
      L.push(`  - Duplicate groups: ${c.duplicateMedia ?? '-'}`);
      L.push(`  - Missing media: ${c.missingMedia ?? '-'}`);
      L.push(`  - Source links: ${c.sourceLinks ?? '-'}`);
      L.push('');
      L.push('HTML structure (body scan):');
      L.push(`  - h1/h2/h3/h4: ${h.body.h1}/${h.body.h2}/${h.body.h3}/${h.body.h4}`);
      L.push(`  - paragraphs: ${h.body.paragraphs}`);
      L.push(`  - lists / list items: ${h.body.lists} / ${h.body.listItems}`);
      L.push(`  - quote cards (nested): ${h.body.quoteCards} (${h.body.nestedQuoteCards})`);
      L.push(`  - time elements: ${h.body.timeElements}`);
      L.push('');
      if (r.images) {
        L.push('Images:');
        L.push(`  - content images: ${r.images.total}`);
        L.push(`  - with width/height: ${r.images.withDims}`);
        L.push(`  - with non-generic alt: ${r.images.nonGenericAlt}`);
        L.push(`  - with SHA-256: ${r.images.withSha}`);
        L.push(`  - missing: ${r.images.missing}`);
        L.push('');
      }
      L.push('Videos (evidence-derived classification):');
      const vm = r.videoModes || {};
      L.push(
        `  - video elements / source elements: ${h.body.videoElements} / ${h.body.sourceElements}`
      );
      L.push(`  - data:video assets embedded: ${h.body.dataVideo}`);
      L.push(`  - offline-video (real offline asset): ${vm.offline ?? 0}`);
      L.push(`  - poster-only: ${vm.posterOnly ?? 0}`);
      L.push(`  - download-failed: ${vm.downloadFailed ?? 0}`);
      L.push(`  - discovery-failed: ${vm.discoveryFailed ?? 0}`);
      L.push(`  - unsupported: ${vm.unsupported ?? 0}`);
      if (vm.offlineUnverified)
        L.push(`  - offline-claimed-but-unverified: ${vm.offlineUnverified}`);
      L.push(`  - "preserved offline" captions: ${h.body.preservedOfflineCaptions}`);
      L.push(`  - fallback figures: ${h.body.fallbackFigures}`);
      L.push('');
      if ((r.videoEvidence || []).length) {
        L.push('Per-video preservation proof:');
        for (const ev of r.videoEvidence) {
          const dur =
            ev.durationSeconds != null
              ? `${Math.floor(ev.durationSeconds / 60)}:${String(Math.round(ev.durationSeconds % 60)).padStart(2, '0')}`
              : '?';
          if (ev.evidence === 'offline-video') {
            const match =
              ev.embeddedBytes === null
                ? 'NO EMBEDDED ASSET FOUND'
                : `embedded ${fmtBytes(ev.embeddedBytes)} (claimed ${fmtBytes(ev.claimedSize)})`;
            L.push(
              `  - ${ev.id}: offline-video | ${dur} | ${match} | mime ${ev.mime || '?'} | ${ev.sha256 ? ev.sha256.slice(0, 23) + '...' : 'no hash'}`
            );
          } else {
            L.push(
              `  - ${ev.id}: ${ev.evidence} (INCOMPLETE) | ${dur} | poster ${yn(ev.posterCaptured)} | source link ${yn(ev.sourceLinkPreserved)} | reason ${ev.failureReason || '?'}`
            );
          }
        }
        L.push('');
      }
      L.push('Links & provenance:');
      L.push(`  - external links: ${h.externalLinks}`);
      L.push(`  - external links missing target/rel: ${h.badLinks}`);
      L.push(
        `  - missing/incomplete records: missing ${(r.missing || []).length}, incomplete ${(r.incomplete || []).length}`
      );
      L.push(`  - duplicate groups: ${(r.duplicates || []).length}`);
      L.push(`  - warnings: ${(r.warnings || []).length}`);
      L.push('');
    }
    // LLM Markdown
    L.push('### LLM Markdown');
    L.push('');
    if (!r.md) {
      L.push('- File: **MISSING**');
      L.push('');
    } else {
      const m = r.md;
      const mdTitleMatch = m.md.match(/^#\s+(.+)$/m);
      L.push(`- File: \`${path.basename(m.file)}\``);
      L.push(`- File size: ${fmtBytes(m.size)}`);
      L.push(`- Title: ${mdTitleMatch ? mdTitleMatch[1].trim() : '(none)'}`);
      L.push(`- Source: ${m.head('Source') || '(none)'}`);
      L.push(`- Exporter: ${m.head('Exporter') || '(none)'}`);
      L.push(`- Exported at: ${m.head('Exported at') || '(none)'}`);
      L.push(`- Language: ${m.head('Language') || '(none)'}`);
      L.push(`- Published at: ${m.head('Published at') || '(none)'}`);
      L.push(`- Author: ${m.head('Author') || '(none)'}`);
      L.push('');
      L.push('Sections present:');
      L.push(`  - Capture Summary: ${yn(m.sections.captureSummary)}`);
      L.push(`  - Main Article: ${yn(m.sections.mainArticle)}`);
      L.push(`  - Embedded / Quoted Posts: ${yn(m.sections.embeddedPosts)}`);
      L.push(`  - Duplicate Media: ${yn(m.sections.duplicateMedia)}`);
      L.push(`  - Media References: ${yn(m.sections.mediaReferences)}`);
      L.push(`  - Missing / Incomplete Content: ${yn(m.sections.missingIncomplete)}`);
      L.push(`  - Source Links: ${yn(m.sections.sourceLinks)}`);
      L.push('');
      L.push('Safety / noise:');
      L.push(`  - contains base64: ${yn(m.leakage.base64)}`);
      L.push(`  - contains data:image: ${yn(m.leakage.dataImage)}`);
      L.push(`  - contains data:video: ${yn(m.leakage.dataVideo)}`);
      L.push(`  - contains CSS/style: ${yn(m.leakage.style)}`);
      L.push(`  - contains script/javascript: ${yn(m.leakage.script)}`);
      L.push('');
      L.push(`- Source links count: ${m.sourceLinks.length} (broken/empty: ${m.emptySourceLinks})`);
      L.push(`- Possibly-truncated posts marked: ${m.truncationMarks}`);
      L.push('');
    }
    // Issues
    L.push('### Issues');
    L.push('');
    if (r.blockers.length) r.blockers.forEach((b) => L.push(`- Blocker: ${b}`));
    if (r.shouldFix.length) r.shouldFix.forEach((b) => L.push(`- Should fix: ${b}`));
    if (r.niceToHave.length) r.niceToHave.forEach((b) => L.push(`- Nice to have: ${b}`));
    if (!r.blockers.length && !r.shouldFix.length && !r.niceToHave.length) L.push('- None. Clean.');
    L.push('');
    L.push(`**Set verdict: ${r.verdict}**`);
    L.push('');
  }

  // Required fixes
  L.push('## Required Fixes Before Public Release');
  L.push('');
  if (!allBlockers.length) {
    L.push('No release blockers found in this audit.');
  } else {
    allBlockers.forEach((b, i) => L.push(`${i + 1}. ${b}`));
  }
  L.push('');
  const allFixes = [];
  for (const r of results) for (const f of r.shouldFix) allFixes.push(`**${r.name}** - ${f}`);
  if (allFixes.length) {
    L.push('Recommended (non-blocking) fixes:');
    L.push('');
    allFixes.forEach((f, i) => L.push(`${i + 1}. ${f}`));
    L.push('');
  }

  // Tag suggestion
  L.push('## Suggested Release Tag');
  L.push('');
  if (overall === 'BLOCKED') {
    L.push(`- **Do not tag v${RELEASE_VERSION}.** Resolve blockers, then re-audit.`);
  } else if (overall === 'PASS WITH FIXES') {
    L.push(
      `- Media accounting is honest (no blockers). Address the non-blocking fixes, then v${RELEASE_VERSION} is defensible.`
    );
  } else {
    L.push(
      `- Clean audit. v${RELEASE_VERSION} is defensible: offline-media completeness and fallback accounting are honest across all sets.`
    );
  }
  L.push('');

  return L.join('\n');
}

function buildJson(results) {
  return {
    schema: 'sourcecapsule-release-audit/1.0',
    generatedAt: new Date().toISOString(),
    overall: results.some((r) => r.blockers.length)
      ? 'BLOCKED'
      : results.some((r) => r.shouldFix.length)
        ? 'PASS WITH FIXES'
        : 'PASS',
    sets: results.map((r) => ({
      name: r.name,
      verdict: r.verdict,
      hasHtml: r.hasHtml,
      hasMd: r.hasMd,
      exporterVersion: r.exporterVersion || null,
      images: r.images || null,
      videoModes: r.videoModes || null,
      videoEvidence: r.videoEvidence || null,
      incompleteVideos: r.incompleteVideos ?? null,
      manifestCapture: r.manifestCapture || null,
      htmlBody: r.html
        ? {
            sizeBytes: r.html.size,
            dataVideoAssets: r.html.body.dataVideo,
            offlineFigures: r.html.body.offlineFigures,
            fallbackFigures: r.html.body.fallbackFigures,
            preservedOfflineCaptions: r.html.body.preservedOfflineCaptions,
            externalLinks: r.html.externalLinks,
            badLinks: r.html.badLinks,
            disclaimer: r.html.body.disclaimer,
          }
        : null,
      markdown: r.md
        ? {
            sizeBytes: r.md.size,
            sections: r.md.sections,
            leakage: r.md.leakage,
            sourceLinks: r.md.sourceLinks.length,
            emptySourceLinks: r.md.emptySourceLinks,
            truncationMarks: r.md.truncationMarks,
          }
        : null,
      blockers: r.blockers,
      shouldFix: r.shouldFix,
      niceToHave: r.niceToHave,
    })),
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let dir = null;
  let jsonPath = null;
  let outPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') jsonPath = args[++i];
    else if (args[i] === '--out') outPath = args[++i];
    else if (!dir) dir = args[i];
  }
  if (!dir) {
    process.stderr.write(
      'Usage: node scripts/audit-release.mjs <exportsDir> [--out <report.md>] [--json <path>]\n'
    );
    process.exit(2);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    process.stderr.write(`Not a directory: ${dir}\n`);
    process.exit(2);
  }
  const sets = discoverSets(dir);
  if (!sets.length) {
    process.stderr.write(`No .html / .llm.md export sets found in ${dir}\n`);
    process.exit(1);
  }
  const results = sets.map(auditSet);
  const report = renderReport(results);
  // Prefer writing the file directly (always clean UTF-8, no BOM). Shell `>` redirection on
  // Windows/PowerShell can mangle stdout into UTF-16LE, so --out is the recommended path.
  if (outPath) {
    fs.writeFileSync(outPath, report, 'utf8');
    process.stderr.write(`Wrote ${outPath}\n`);
  } else {
    process.stdout.write(report);
  }
  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify(buildJson(results), null, 2), 'utf8');
    process.stderr.write(`Wrote ${jsonPath}\n`);
  }
  // exit non-zero if blocked, so CI can gate on it
  process.exitCode = results.some((r) => r.blockers.length) ? 1 : 0;
}

main();
