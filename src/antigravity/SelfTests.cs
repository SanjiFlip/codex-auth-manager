using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace AntigravitySwitcher
{
    public sealed class MemoryCredentialStore : ICredentialStore
    {
        public Credential Value;
        public int FailWrites;
        public int Writes;
        public Credential Read() { return Value == null ? null : Json.Parse<Credential>(Json.Stringify(Value)); }
        public void Write(Credential value)
        {
            Writes++;
            if (FailWrites > 0) { FailWrites--; throw new IOException("Injected write failure"); }
            Value = Json.Parse<Credential>(Json.Stringify(value));
        }
        public void Delete() { Value = null; }
    }
    public static class SelfTests
    {
        public static string TempRoot() { return Path.Combine(Path.GetTempPath(), "AgSwitcher-Test-" + Guid.NewGuid().ToString("N")); }
        public static void Cleanup(string path)
        {
            string full = Path.GetFullPath(path);
            if (!Path.GetDirectoryName(full).TrimEnd('\\').Equals(Path.GetTempPath().TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) ||
                !Path.GetFileName(full).StartsWith("AgSwitcher-Test-", StringComparison.Ordinal)) throw new IOException("Unsafe test cleanup path");
            if (Directory.Exists(full)) Directory.Delete(full, true);
        }
        public static Credential Fixture(string subject, string email, string refresh)
        {
            string payload = Convert.ToBase64String(Encoding.UTF8.GetBytes(Json.Stringify(new { sub = subject, email = email }))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            string content = Json.Stringify(new { token = new { access_token = "synthetic-access", refresh_token = refresh, token_type = "Bearer", expiry = "2020-01-01T00:00:00Z" }, auth_method = "google", id_token = "e30." + payload + ".synthetic" });
            return new Credential { Flags = 0, Persist = 2, UserName = "antigravity", Comment = "Synthetic test credential", Blob = Encoding.UTF8.GetBytes(content), Attributes = new CredentialAttribute[0] };
        }
        private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
        private static void Throws(Action action, string message)
        {
            try { action(); } catch { return; }
            throw new Exception(message);
        }
        public static int Run(string reportPath)
        {
            var results = new List<object>();
            int failures = 0;
            Action<string, Action<SwitchEngine, MemoryCredentialStore>> run = delegate(string name, Action<SwitchEngine, MemoryCredentialStore> action)
            {
                string temp = TempRoot();
                try
                {
                    var store = new MemoryCredentialStore { Value = Fixture("A", "a@example.com", "refresh-A") };
                    var engine = new SwitchEngine(new Vault(temp), store, delegate { });
                    action(engine, store);
                    results.Add(new { Name = name, Passed = true, Error = "" });
                }
                catch (Exception ex) { failures++; results.Add(new { Name = name, Passed = false, Error = ex.Message }); }
                finally { Cleanup(temp); }
            };
            run("Save and DPAPI encrypted round trip", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var p = e.SaveCurrent("工作账号");
                Assert(e.Vault.Get(p.Id).Credential.SameAs(s.Value), "Credential changed in round trip");
                var bytes = File.ReadAllBytes(e.Vault.ProfilePath(p.Id));
                Assert(!Encoding.UTF8.GetString(bytes).Contains("refresh-A"), "Plaintext token on disk");
            });
            run("Duplicate identity updates the same profile", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); s.Value = Fixture("A", "a@example.com", "rotated-refresh");
                var b = e.SaveCurrent("Updated"); Assert(a.Id == b.Id && e.Vault.Profiles().Count == 1, "Duplicate profile created");
                Assert(e.Vault.Get(a.Id).Credential.SameAs(s.Value), "Refresh token not updated");
            });
            run("Duplicate label rejected without overwrite", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); s.Value = Fixture("B", "b@example.com", "refresh-B");
                Throws(delegate { e.SaveCurrent(" a "); }, "Duplicate accepted");
                Assert(e.Vault.Get(a.Id).Identity.Key != AccountIdentity.From(s.Value).Key, "Other account overwritten");
            });
            run("Unicode rename and shell metacharacters remain data", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var p = e.SaveCurrent("中文 $() & ' ; <名称>");
                e.Rename(p.Id, "新名称"); Assert(e.Vault.Get(p.Id).Name == "新名称", "Rename failed");
                Throws(delegate { e.Rename(p.Id, "\n"); }, "Invalid name accepted");
            });
            run("Switch preserves refreshed source and creates encrypted backup", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); s.Value = Fixture("B", "b@example.com", "refresh-B"); var b = e.SaveCurrent("B");
                s.Value = Fixture("A", "a@example.com", "refresh-A-new"); var before = s.Read(); e.Switch(b.Id);
                Assert(s.Value.SameAs(b.Credential), "Target not selected");
                Assert(e.Vault.Get(a.Id).Credential.SameAs(before), "Refreshed source lost");
                Assert(e.Vault.Backups().Single().Before.SameAs(before) && !e.Vault.Pending, "Backup or journal incorrect");
            });
            run("Same account never restores stale token", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var p = e.SaveCurrent("A"); s.Value = Fixture("A", "a@example.com", "new-token"); var latest = s.Read();
                e.Switch(p.Id); Assert(s.Value.SameAs(latest) && s.Writes == 0, "Stale token restored");
            });
            run("Failed write rolls back exactly", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); s.Value = Fixture("B", "b@example.com", "refresh-B"); var before = s.Read(); s.FailWrites = 1;
                Throws(delegate { e.Switch(a.Id); }, "Failure missing");
                Assert(s.Value.SameAs(before) && !e.Vault.Pending, "Rollback failed");
            });
            run("Startup belongs to the credential transaction", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); s.Value = Fixture("B", "b@example.com", "refresh-B"); var before = s.Read();
                bool stopped = false;
                Action launch = delegate { Assert(e.Vault.Pending, "Recovery journal cleared before startup"); throw new IOException("Injected startup failure"); };
                Action stop = delegate { stopped = true; };
                Throws(delegate { e.Switch(a.Id, launch, stop, null); }, "Startup failure accepted");
                Assert(stopped && s.Value.SameAs(before) && !e.Vault.Pending, "Startup failure did not stop and restore original login");
            });
            run("Successful startup keeps journal until confirmed and preserves source", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); s.Value = Fixture("B", "b@example.com", "refresh-B"); var b = e.SaveCurrent("B");
                s.Value = Fixture("B", "b@example.com", "rotated-B"); var before = s.Read();
                var phases = new List<string>();
                e.Switch(a.Id, delegate { Assert(e.Vault.Pending && s.Value.SameAs(a.Credential), "Startup precedes protected write"); },
                    delegate { throw new Exception("Unexpected stop"); }, phases.Add);
                Assert(!e.Vault.Pending && e.Vault.Get(b.Id).Credential.SameAs(before), "Successful switch lost latest source or journal");
                Assert(string.Join(",", phases) == "saving,writing,starting", "Progress phases out of order");
            });
            run("Failed startup stop keeps target and recoverable journal", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); s.Value = Fixture("B", "b@example.com", "refresh-B"); var before = s.Read();
                Throws(delegate { e.Switch(a.Id, delegate { throw new IOException("startup"); }, delegate { throw new IOException("busy"); }, null); }, "Failure missing");
                Assert(e.Vault.Pending && s.Value.SameAs(a.Credential), "Wrote original while app may be running");
                e.RecoverPending(); Assert(!e.Vault.Pending && s.Value.SameAs(before), "Pending startup recovery failed");
            });
            run("Unrelated Node and language servers do not block Antigravity", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                string installation = @"C:\Apps\CustomAG\Antigravity.exe";
                Assert(!AntigravityApp.RelatedRuntime(@"C:\Node\node.exe", null, installation), "Uninspectable unrelated Node marked busy");
                Assert(!AntigravityApp.RelatedRuntime(@"C:\Other\language_server.exe", "other.js", installation), "Unrelated language server marked busy");
                Assert(AntigravityApp.RelatedRuntime(@"C:\Apps\CustomAG\resources\bin\language_server.exe", null, installation), "Custom install server missed");
                Assert(AntigravityApp.RelatedRuntime(@"C:\Node\node.exe", @"node C:\tools\antigravity\cli.js", installation), "Shared CLI missed");
            });
            run("Failed rollback retains journal and recover restores it", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); s.Value = Fixture("B", "b@example.com", "refresh-B"); var before = s.Read(); s.FailWrites = 2;
                Throws(delegate { e.Switch(a.Id); }, "Failure missing"); Assert(e.Vault.Pending, "Recovery journal lost");
                Throws(delegate { e.SaveCurrent("Blocked"); }, "Mutation allowed before recovery");
                e.RecoverPending(); Assert(!e.Vault.Pending && s.Value.SameAs(before), "Recovery failed");
            });
            run("Restore backup is reversible", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); s.Value = Fixture("B", "b@example.com", "refresh-B"); var before = s.Read();
                e.Switch(a.Id); var backup = e.Vault.Backups().Single(); e.Restore(backup);
                Assert(s.Value.SameAs(before) && e.Vault.Backups().Count == 2, "Restore lost history");
            });
            run("Switch and restore from signed-out state", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); s.Value = null; e.Switch(a.Id); Assert(s.Value != null, "Signed-out switch failed");
                e.Restore(e.Vault.Backups().Single()); Assert(s.Value == null, "Signed-out state not restored");
            });
            run("Busy application blocks credential writes", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); s.Value = Fixture("B", "b@example.com", "refresh-B");
                var busy = new SwitchEngine(e.Vault, s, delegate { throw new IOException("busy"); });
                Throws(delegate { busy.Switch(a.Id); }, "Busy application accepted"); Assert(s.Writes == 0, "Wrote while busy");
            });
            run("Tampered DPAPI profile fails before credential writes", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); var path = e.Vault.ProfilePath(a.Id); var bytes = File.ReadAllBytes(path); bytes[bytes.Length - 5] ^= 64; File.WriteAllBytes(path, bytes);
                Throws(delegate { e.Switch(a.Id); }, "Corrupted profile accepted"); Assert(s.Writes == 0, "Wrote invalid credentials");
            });
            run("Path traversal is rejected", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                Throws(delegate { e.Vault.ProfilePath("..\\outside"); }, "Traversal accepted");
                Throws(delegate { e.Vault.Write(Path.Combine(e.Vault.Root, "..", "outside"), new { Value = 1 }); }, "Outside write accepted");
            });
            run("Remove archives without changing current credential", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                var a = e.SaveCurrent("A"); var before = s.Read(); e.Remove(a.Id);
                Assert(e.Vault.Profiles().Count == 0 && s.Value.SameAs(before), "Removal altered login");
                Assert(Directory.GetFiles(Path.Combine(e.Vault.Root, "removed")).Length == 1, "Removed credential not retained");
            });
            run("Unsupported and missing credentials rejected", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                s.Value.Blob = Encoding.UTF8.GetBytes("{}"); Throws(delegate { e.SaveCurrent("bad"); }, "Unsupported credential saved");
                s.Value = null; Throws(delegate { e.SaveCurrent("none"); }, "Missing credential saved");
            });
            run("Native Windows credential API isolated round trip including attributes", delegate(SwitchEngine e, MemoryCredentialStore s)
            {
                // This target is unique and never aliases the real Antigravity credential.
                var native = new WindowsCredentialStore("AgSwitcher.SelfTest:" + Guid.NewGuid().ToString("N"));
                try
                {
                    Assert(native.Read() == null, "Test target exists unexpectedly");
                    var fixture = Fixture("NativeTest", "test@example.com", "synthetic-refresh");
                    fixture.Attributes = new[] { new CredentialAttribute { Keyword = "test", Flags = 0, Value = new byte[] { 1, 2, 3 } } };
                    native.Write(fixture); Assert(fixture.SameAs(native.Read()), "Native serialization mismatch");
                    native.Delete(); Assert(native.Read() == null, "Native delete failed");
                }
                finally { native.Delete(); }
            });
            File.WriteAllText(reportPath, Json.Stringify(new { Passed = results.Count - failures, Failed = failures,
                RealAntigravityCredentialWrites = 0, Tests = results }), Encoding.UTF8);
            return failures == 0 ? 0 : 1;
        }
    }
}
