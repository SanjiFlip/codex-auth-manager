using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Security.Principal;

namespace AntigravitySwitcher
{
    public sealed class Request
    {
        public string action { get; set; }
        public string id { get; set; }
        public string name { get; set; }
        public string executable { get; set; }
        public bool forceClose { get; set; }
    }
    public static class Bridge
    {
        public static int Main(string[] args)
        {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            try
            {
                if (args.Length == 2 && args[0] == "--self-test") return SelfTests.Run(Path.GetFullPath(args[1]));
                if (args.Length != 0) throw new InvalidOperationException("无效参数。");
                var request = Json.Parse<Request>(Console.ReadLine());
                bool first;
                using (var mutex = new Mutex(true, @"Local\AntigravityAccountSwitcher-" + WindowsIdentity.GetCurrent().User.Value, out first))
                {
                    if (!first) throw new InvalidOperationException("另一个 Antigravity 切换操作或旧版切换器正在运行，请先关闭旧版切换器。");
                    try { Console.WriteLine(Json.Stringify(new { ok = true, data = Execute(request) })); }
                    finally { mutex.ReleaseMutex(); }
                }
                return 0;
            }
            catch (Exception ex)
            {
                // Only controlled application messages cross the process boundary.
                string message = ex is InvalidOperationException || ex is IOException || ex is System.ComponentModel.Win32Exception
                    ? ex.Message : "无法读取账号库或执行操作。请检查本机权限与加密文件。";
                Console.WriteLine(Json.Stringify(new { ok = false, error = message }));
                return 1;
            }
        }
        private static object Execute(Request r)
        {
            var vault = new Vault(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AntigravityAccountSwitcher"));
            string settings = Path.Combine(vault.Root, "settings.agvault");
            string exe = File.Exists(settings) ? vault.Read<AppSettings>(settings).Executable : AntigravityApp.Detect();
            var engine = new SwitchEngine(vault, new WindowsCredentialStore(WindowsCredentialStore.AntigravityTarget), delegate { AntigravityApp.RequireIdle(exe); });
            string message = "";
            object switchStatus = null;
            switch (r.action)
            {
                case "state": break;
                case "save": engine.SaveCurrent(r.name); break;
                case "rename": engine.Rename(r.id, r.name); break;
                case "remove": engine.Remove(r.id); break;
                case "configure":
                    AntigravityApp.Validate(r.executable);
                    exe = r.executable;
                    vault.Write(settings, new AppSettings { Executable = exe });
                    break;
                case "open":
                    if (vault.Pending) throw new InvalidOperationException("请先恢复中断的切换。");
                    AntigravityApp.Launch(exe); break;
                case "switch":
                    // Validate target before requesting application shutdown.
                    Progress("checking");
                    vault.Get(r.id);
                    if (vault.Pending) throw new InvalidOperationException("请先恢复中断的切换。");
                    AntigravityApp.Validate(exe);
                    Progress("closing");
                    AntigravityApp.RequestClose(exe, r.forceClose);
                    engine.Switch(r.id, delegate { AntigravityApp.Launch(exe); },
                        delegate { AntigravityApp.RequestClose(exe, r.forceClose); }, Progress);
                    Progress("restarted");
                    message = "Antigravity 已重启，请在账号菜单核对登录身份。";
                    switchStatus = new { phase = "restarted", message = message, identityVerified = false };
                    break;
                case "restore":
                    var backup = vault.Pending ? null : vault.Backups().FirstOrDefault(b => b.Id == r.id);
                    if (!vault.Pending && backup == null) throw new InvalidOperationException("找不到所选备份，请刷新。");
                    // Recovery must remain possible even after Antigravity is uninstalled.
                    AntigravityApp.RequireIdle(exe);
                    if (vault.Pending) engine.RecoverPending(); else engine.Restore(backup);
                    message = "原登录凭据已恢复。可点击打开 Antigravity 核对身份。";
                    break;
                default: throw new InvalidOperationException("不支持的操作。");
            }
            string warning = "";
            AccountIdentity current = null;
            try { current = engine.Current(); } catch (Exception) { warning = "当前登录不可识别，请在 Antigravity 重新登录；仍可恢复历史备份。"; }
            bool installed = false;
            try { AntigravityApp.Validate(exe); installed = true; } catch { }
            return new {
                supported = true, installed = installed, executable = exe, version = AntigravityApp.Version(exe),
                pending = vault.Pending, warning = warning, message = message, switchStatus = switchStatus,
                current = current == null ? null : current.Email,
                accounts = vault.Profiles().Select(p => new { id = p.Id, name = p.Name, email = p.Identity.Email,
                    current = current != null && current.Key == p.Identity.Key, savedAt = p.SavedUtc.ToString("o") }).ToArray(),
                backups = vault.Backups().Select(b => new { id = b.Id, reason = b.Reason, createdAt = b.CreatedUtc.ToString("o") }).ToArray()
            };
        }
        private static void Progress(string phase)
        {
            string message;
            switch (phase)
            {
                case "checking": message = "正在检查目标账号与 Antigravity 安装位置"; break;
                case "closing": message = "正在关闭 Antigravity，等待进程完全退出"; break;
                case "saving": message = "正在保存当前账号的最新登录状态"; break;
                case "writing": message = "正在写入目标账号凭据并回读检查"; break;
                case "starting": message = "正在启动 Antigravity 并检查进程"; break;
                case "rollback": message = "切换未完成，正在恢复原登录凭据"; break;
                default: message = "Antigravity 已重启，请在账号菜单核对登录身份"; break;
            }
            Console.WriteLine(Json.Stringify(new { @event = "progress", phase = phase, message = message }));
        }
    }
}
