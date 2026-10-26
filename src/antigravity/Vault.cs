using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace AntigravitySwitcher
{
    public sealed class Profile
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public DateTime SavedUtc { get; set; }
        public Credential Credential { get; set; }
        public AccountIdentity Identity { get { return AccountIdentity.From(Credential); } }
    }
    public sealed class Backup
    {
        public string Id { get; set; }
        public string Reason { get; set; }
        public DateTime CreatedUtc { get; set; }
        public Credential Before { get; set; }
    }

    public sealed class Vault
    {
        public readonly string Root;
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("AntigravitySwitcher.Desktop.v1");
        public string ProfilesPath { get { return Path.Combine(Root, "profiles"); } }
        public string BackupsPath { get { return Path.Combine(Root, "backups"); } }
        public string PendingPath { get { return Path.Combine(Root, "pending.agvault"); } }
        public bool Pending { get { return File.Exists(PendingPath); } }
        public Vault(string root) { Root = Path.GetFullPath(root); }

        public static void ValidateName(string name)
        {
            if (string.IsNullOrWhiteSpace(name) || name.Length > 48 || name.Any(char.IsControl))
                throw new InvalidOperationException("账号名称需要 1–48 个可见字符。");
        }
        public string ProfilePath(string id)
        {
            Guid guid;
            if (!Guid.TryParseExact(id, "N", out guid)) throw new InvalidOperationException("无效的账号标识。");
            return Path.Combine(ProfilesPath, id + ".agvault");
        }
        public void Write<T>(string path, T data)
        {
            GuardPath(path);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            byte[] plain = Encoding.UTF8.GetBytes(Json.Stringify(data));
            byte[] encrypted;
            try { encrypted = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser); }
            finally { Array.Clear(plain, 0, plain.Length); }
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                { file.Write(encrypted, 0, encrypted.Length); file.Flush(true); }
                if (File.Exists(path)) File.Replace(temp, path, null);
                else File.Move(temp, path);
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        public T Read<T>(string path)
        {
            GuardPath(path);
            byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.CurrentUser);
            try { return Json.Parse<T>(Encoding.UTF8.GetString(plain)); }
            finally { Array.Clear(plain, 0, plain.Length); }
        }
        public void GuardPath(string path)
        {
            string full = Path.GetFullPath(path);
            if (!full.StartsWith(Root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase))
                throw new IOException("文件路径超出账号库目录。");
            for (string p = full; !string.IsNullOrEmpty(p); p = Path.GetDirectoryName(p))
            {
                if ((File.Exists(p) || Directory.Exists(p)) && (File.GetAttributes(p) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("账号库不能放在符号链接或目录联接中。");
            }
        }
        public List<Profile> Profiles()
        {
            if (!Directory.Exists(ProfilesPath)) return new List<Profile>();
            GuardPath(Path.Combine(ProfilesPath, "probe"));
            return Directory.GetFiles(ProfilesPath, "*.agvault").Select(p =>
            {
                var profile = Read<Profile>(p);
                if (ProfilePath(profile.Id) != p) throw new IOException("账号文件标识不匹配。");
                ValidateName(profile.Name);
                var identity = profile.Identity;
                return profile;
            }).OrderBy(p => p.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        }
        public Profile Get(string id)
        {
            var profile = Read<Profile>(ProfilePath(id));
            if (profile.Id != id) throw new IOException("账号文件标识不匹配。");
            var identity = profile.Identity;
            return profile;
        }
        public void Save(Profile profile) { ValidateName(profile.Name); Write(ProfilePath(profile.Id), profile); }
        public List<Backup> Backups()
        {
            if (!Directory.Exists(BackupsPath)) return new List<Backup>();
            GuardPath(Path.Combine(BackupsPath, "probe"));
            return Directory.GetFiles(BackupsPath, "*.agvault").Select(Read<Backup>).OrderByDescending(b => b.CreatedUtc).ToList();
        }
        public void Archive(string id)
        {
            string from = ProfilePath(id);
            string to = Path.Combine(Root, "removed", id + "-" + Guid.NewGuid().ToString("N") + ".agvault");
            GuardPath(from); GuardPath(to);
            Directory.CreateDirectory(Path.GetDirectoryName(to));
            File.Move(from, to);
        }
        public void ClearPending() { GuardPath(PendingPath); File.Delete(PendingPath); }
    }

    public sealed class SwitchEngine
    {
        public readonly Vault Vault;
        private readonly ICredentialStore store;
        private readonly Action requireIdle;
        public SwitchEngine(Vault vault, ICredentialStore store, Action requireIdle)
        { Vault = vault; this.store = store; this.requireIdle = requireIdle; }
        public AccountIdentity Current() { return AccountIdentity.From(store.Read()); }
        private void Ready()
        {
            if (Vault.Pending) throw new InvalidOperationException("上次切换被中断。请先点击“恢复备份”恢复原凭据。");
        }
        public Profile SaveCurrent(string name)
        {
            Ready(); Vault.ValidateName(name); name = name.Trim();
            var current = store.Read();
            var identity = AccountIdentity.From(current);
            if (identity == null) throw new InvalidOperationException("尚未检测到登录账号。请先打开 Antigravity，完成 Google 登录，再点击刷新。");
            var profiles = Vault.Profiles();
            var match = profiles.FirstOrDefault(p => p.Identity.Key == identity.Key);
            if (profiles.Any(p => p.Name.Equals(name, StringComparison.CurrentCultureIgnoreCase) && p != match))
                throw new InvalidOperationException("这个名称已被其他账号使用。");
            var saved = new Profile { Id = match == null ? Guid.NewGuid().ToString("N") : match.Id,
                Name = name.Trim(), SavedUtc = DateTime.UtcNow, Credential = current };
            Vault.Save(saved);
            return saved;
        }
        public void Rename(string id, string name)
        {
            Ready(); Vault.ValidateName(name); name = name.Trim();
            if (Vault.Profiles().Any(p => p.Id != id && p.Name.Equals(name, StringComparison.CurrentCultureIgnoreCase)))
                throw new InvalidOperationException("这个名称已经存在。");
            var profile = Vault.Get(id); profile.Name = name; Vault.Save(profile);
        }
        public void Remove(string id) { Ready(); Vault.Archive(id); }
        public void Switch(string id)
        { Switch(id, null, null, null); }
        public void Switch(string id, Action launch, Action stop, Action<string> report)
        {
            Ready(); requireIdle();
            var target = Vault.Get(id);
            if (report != null) report("saving");
            var before = store.Read();
            var current = AccountIdentity.From(before);
            // Match actual identity, never a stale UI marker; retain refreshed tokens before leaving an account.
            if (current != null)
            {
                var saved = Vault.Profiles().FirstOrDefault(p => p.Identity.Key == current.Key);
                if (saved != null) { saved.Credential = before; saved.SavedUtc = DateTime.UtcNow; Vault.Save(saved); }
                if (current.Key == target.Identity.Key)
                {
                    if (report != null) report("starting");
                    if (launch != null) launch();
                    return;
                }
            }
            Apply(target.Credential, "切换至 " + target.Name, before, launch, stop, report);
        }
        public void Restore(Backup backup)
        {
            Ready(); requireIdle();
            if (backup.Before != null) AccountIdentity.From(backup.Before);
            Apply(backup.Before, "恢复备份", store.Read());
        }
        public void RecoverPending()
        {
            requireIdle();
            var pending = Vault.Read<Backup>(Vault.PendingPath);
            SetAndVerify(pending.Before);
            Vault.ClearPending();
        }
        private void SetAndVerify(Credential target)
        {
            if (target == null) store.Delete(); else store.Write(target);
            var actual = store.Read();
            if (target == null ? actual != null : !target.SameAs(actual)) throw new IOException("登录凭据回读校验未通过。");
        }
        private void Apply(Credential target, string reason, Credential before, Action launch = null, Action stop = null, Action<string> report = null)
        {
            var backup = new Backup { Id = Guid.NewGuid().ToString("N"), Reason = reason, CreatedUtc = DateTime.UtcNow, Before = before };
            Vault.Write(Path.Combine(Vault.BackupsPath, backup.Id + ".agvault"), backup);
            Vault.Write(Vault.PendingPath, backup);
            bool launchAttempted = false;
            try
            {
                requireIdle();
                if (report != null) report("writing");
                SetAndVerify(target);
                if (launch != null)
                {
                    if (report != null) report("starting");
                    launchAttempted = true;
                    launch();
                }
                Vault.ClearPending();
            }
            catch
            {
                try
                {
                    if (report != null) report("rollback");
                    if (launchAttempted && stop != null) stop();
                    requireIdle(); SetAndVerify(before); Vault.ClearPending();
                }
                catch { throw new IOException("切换未完成，原凭据已加密备份。请退出 Antigravity 后，点击“恢复备份”完成恢复。"); }
                throw new IOException("切换失败，已经恢复原登录凭据。Antigravity 保持关闭，可重新打开后检查。");
            }
        }
    }
}
