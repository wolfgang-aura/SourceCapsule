// Native messaging launcher.
//
// Chromium on Windows is fussy about batch-file hosts, so the registered host is a real
// executable. All this does is start the Node host and shuttle the three standard
// streams through untouched. Native messaging framing is binary and length-prefixed, so
// the copies must stay raw: no text decoding, no newline translation, no buffering that
// outlives a message.
//
// Built by scripts/install-native-host.ps1 via Add-Type, which uses the .NET compiler
// already present on Windows. No toolchain to install.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;

public static class SourceCapsuleLauncher
{
    private static void Pump(Stream from, Stream to)
    {
        byte[] buffer = new byte[8192];
        try
        {
            int read;
            while ((read = from.Read(buffer, 0, buffer.Length)) > 0)
            {
                to.Write(buffer, 0, read);
                to.Flush();
            }
        }
        catch (Exception)
        {
            // A closed pipe just means the other side went away; let the process exit.
        }
    }

    public static int Main(string[] args)
    {
        string here = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string script = Path.Combine(here, "sourcecapsule-host.mjs");
        string node = Environment.GetEnvironmentVariable("SOURCECAPSULE_NODE");
        if (string.IsNullOrEmpty(node))
        {
            node = Path.Combine(here, "node-path.txt");
            node = File.Exists(node) ? File.ReadAllText(node).Trim() : "node.exe";
        }

        // Chrome appends the calling extension origin (and a window handle) as arguments.
        // The host ignores them, but they are forwarded so it can log them if needed.
        string arguments = "\"" + script + "\"";
        foreach (string arg in args)
        {
            arguments += " \"" + arg + "\"";
        }

        ProcessStartInfo info = new ProcessStartInfo(node, arguments);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;

        using (Process child = Process.Start(info))
        {
            Thread toChild = new Thread(delegate ()
            {
                Pump(Console.OpenStandardInput(), child.StandardInput.BaseStream);
            });
            Thread fromChild = new Thread(delegate ()
            {
                Pump(child.StandardOutput.BaseStream, Console.OpenStandardOutput());
            });
            Thread errFromChild = new Thread(delegate ()
            {
                Pump(child.StandardError.BaseStream, Console.OpenStandardError());
            });
            toChild.IsBackground = true;
            fromChild.IsBackground = true;
            errFromChild.IsBackground = true;
            toChild.Start();
            fromChild.Start();
            errFromChild.Start();

            child.WaitForExit();
            fromChild.Join(2000);
            return child.ExitCode;
        }
    }
}
