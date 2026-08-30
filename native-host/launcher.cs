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

    private static void Trace(string message)
    {
        // Written before anything can fail, so an empty log means the browser never
        // invoked the host at all, and a log with only a start line means Node failed.
        try
        {
            string logPath = Path.Combine(
                Path.GetTempPath(), "sourcecapsule-launcher.log");
            File.AppendAllText(
                logPath, DateTime.UtcNow.ToString("o") + "  " + message + Environment.NewLine);
        }
        catch (Exception)
        {
        }
    }

    public static int Main(string[] args)
    {
        Trace("launcher invoked with " + args.Length + " arg(s): " + string.Join(" | ", args));
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

        Trace("node=" + node + " script=" + script);
        if (!File.Exists(node))
        {
            Trace("FATAL: node executable not found");
            return 2;
        }
        ProcessStartInfo info = new ProcessStartInfo(node, arguments);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;

        Process child;
        try
        {
            child = Process.Start(info);
        }
        catch (Exception error)
        {
            Trace("FATAL: could not start node: " + error.Message);
            return 3;
        }
        using (child)
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

            // When the browser goes away its stdin hits EOF and the to-child pump
            // returns. Nothing else closes the child's stdin, so without this the Node
            // host never sees EOF, never exits, and this launcher blocks forever on
            // WaitForExit. The orphan keeps the capture named pipe, and every later CLI
            // request is answered by a host whose browser is long dead - which looks
            // exactly like "the host is unreachable".
            Thread reaper = new Thread(delegate ()
            {
                toChild.Join();
                Trace("browser stream closed; closing node stdin");
                try
                {
                    child.StandardInput.Close();
                }
                catch (Exception)
                {
                }
                if (!child.WaitForExit(5000))
                {
                    Trace("node did not exit after stdin close; killing it");
                    try
                    {
                        child.Kill();
                    }
                    catch (Exception)
                    {
                    }
                }
            });
            reaper.IsBackground = true;
            reaper.Start();

            child.WaitForExit();
            fromChild.Join(2000);
            Trace("node exited with " + child.ExitCode);
            return child.ExitCode;
        }
    }
}
