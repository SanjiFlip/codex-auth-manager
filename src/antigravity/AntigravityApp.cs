using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Threading;

namespace AntigravitySwitcher
{
    public sealed class AppSettings
    {
        public string Executable { get; set; }
    }
    public static class AntigravityApp
    {
        public static string Detect()
        {
            string[] candidates = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Antigravity", "Antigravity.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Antigravity", "Antigravity.exe")
            };
            return candidates.FirstOrDefault(File.Exists) ?? "";
        }
        public static void Validate(string executable)
        {
            if (string.IsNullOrWhiteSpace(executable) || !File.Exists(executable) ||
                !Path.GetFileName(executable).Equals("Antigravity.exe", StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(Path.Combine(Path.GetDirectoryName(executable), "resources", "app.asar")) ||
                !File.Exists(Path.Combine(Path.GetDirectoryName(executable), "resources", "bin", "language_server.exe")))
                throw new InvalidOperationException("请选择 Antigravity 桌面版的 Antigravity.exe；当前路径不存在或缺少所需组件。");
        }
        public static string Version(string executable)
        {
            try { return FileVersionInfo.GetVersionInfo(executable).FileVersion; }
            catch { return "未检测到"; }
        }
        public static bool RelatedRuntime(string executable, string command, string installation)
        {
            if (!string.IsNullOrWhiteSpace(installation) && !string.IsNullOrWhiteSpace(executable) &&
                executable.StartsWith(Path.GetDirectoryName(Path.GetFullPath(installation)) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return true;
            string value = ((executable ?? "") + " " + (command ?? "")).Replace('/', '\\');
            return value.IndexOf("\\Antigravity\\", StringComparison.OrdinalIgnoreCase) >= 0 ||
                value.IndexOf("\\antigravity-cli\\", StringComparison.OrdinalIgnoreCase) >= 0 ||
                value.IndexOf("\\agy.js", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        public static List<int> Running(string executable = null)
        {
            var ids = new HashSet<int>();
            foreach (string name in new[] { "Antigravity", "Antigravity-IDE", "agy", "antigravity-cli" })
                foreach (var process in Process.GetProcessesByName(name))
                    using (process) ids.Add(process.Id);
            // CLI and IDE extension sessions may share the credential. Inspect command lines locally, never log them.
            using (var search = new ManagementObjectSearcher("SELECT ProcessId, ExecutablePath, CommandLine FROM Win32_Process WHERE Name='node.exe' OR Name='language_server.exe' OR Name='language_server_windows_x64.exe'"))
            using (var found = search.Get())
                foreach (ManagementObject process in found)
                    using (process)
                    {
                        string command = process["CommandLine"] as string;
                        string runtime = process["ExecutablePath"] as string;
                        if (RelatedRuntime(runtime, command, executable))
                            ids.Add(Convert.ToInt32(process["ProcessId"]));
                    }
            return ids.ToList();
        }
        public static void RequireIdle(string executable = null)
        {
            if (Running(executable).Count > 0)
                throw new InvalidOperationException("[ANTIGRAVITY_STILL_RUNNING] Antigravity 或共享登录的 CLI / 语言服务仍在运行。请从托盘彻底退出应用并关闭相关 CLI，再重试。");
        }
        public static void RequestClose(string executable, bool force = false)
        {
            Validate(executable);
            foreach (int id in Running(executable))
            {
                Process process;
                try { process = Process.GetProcessById(id); } catch (ArgumentException) { continue; }
                using (process)
                {
                    string file;
                    try { file = process.MainModule.FileName; }
                    catch (System.ComponentModel.Win32Exception) { continue; }
                    // Explicit force confirmation covers only this installation, never every Node/CLI process.
                    if (!file.StartsWith(Path.GetDirectoryName(Path.GetFullPath(executable)) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
                    if (force) { try { process.Kill(); } catch (InvalidOperationException) { } }
                    else if (process.MainWindowHandle != IntPtr.Zero) process.CloseMainWindow();
                }
            }
            for (int i = 0; i < 24; i++)
            {
                if (Running(executable).Count == 0) return;
                Thread.Sleep(500);
            }
            RequireIdle(executable);
        }
        public static void Launch(string executable)
        {
            Validate(executable);
            using (var process = Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(executable) }))
            {
                if (process == null) throw new IOException("无法确认 Antigravity 启动。");
                if (process.WaitForExit(1500)) throw new IOException("Antigravity 启动后立即退出。");
            }
        }
    }
}
