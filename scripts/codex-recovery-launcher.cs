using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// Compiled as a Windows GUI application. Neither this process nor its child
// allocates a console; WindowStyle.Hidden alone cannot guarantee no flash.
internal static class CodexRecoveryLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 1 || (args[0] != "Check" && args[0] != "Restart")) return 64;
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string log = Path.Combine(root, "launcher-" + args[0] + ".log");
        try
        {
            string script = Path.Combine(root, "codex-recovery.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("Recovery script missing.", script);
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File \"" + script + "\" -StateRoot \"" + root + "\" -Action " + args[0],
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = Process.Start(start))
            {
                var stdout = process.StandardOutput.ReadToEndAsync();
                var stderr = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(args[0] == "Restart" ? 100000 : 40000))
                {
                    process.Kill();
                    File.WriteAllText(log, DateTime.UtcNow.ToString("o") + " timed out", Encoding.UTF8);
                    return 124;
                }
                File.WriteAllText(log, DateTime.UtcNow.ToString("o") + Environment.NewLine + stdout.Result + stderr.Result, Encoding.UTF8);
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            try { File.WriteAllText(log, DateTime.UtcNow.ToString("o") + " " + error.Message, Encoding.UTF8); }
            catch { /* Cannot write diagnostics; retain a nonzero exit code. */ }
            return 1;
        }
    }
}
