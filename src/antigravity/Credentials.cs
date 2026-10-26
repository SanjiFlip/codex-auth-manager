using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace AntigravitySwitcher
{
    public sealed class CredentialAttribute
    {
        public string Keyword { get; set; }
        public uint Flags { get; set; }
        public byte[] Value { get; set; }
    }

    public sealed class Credential
    {
        public uint Flags { get; set; }
        public uint Persist { get; set; }
        public string UserName { get; set; }
        public string Comment { get; set; }
        public string TargetAlias { get; set; }
        public byte[] Blob { get; set; }
        public CredentialAttribute[] Attributes { get; set; }

        public bool SameAs(Credential other)
        {
            return other != null && Json.Stringify(this) == Json.Stringify(other);
        }
    }

    public interface ICredentialStore
    {
        Credential Read();
        void Write(Credential credential);
        void Delete();
    }

    public sealed class WindowsCredentialStore : ICredentialStore
    {
        public const string AntigravityTarget = "gemini:antigravity";
        private readonly string target;
        public WindowsCredentialStore(string targetName) { target = targetName; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct NativeCredential
        {
            public uint Flags, Type;
            public string TargetName, Comment;
            public long LastWritten;
            public uint BlobSize;
            public IntPtr Blob;
            public uint Persist, AttributeCount;
            public IntPtr Attributes;
            public string TargetAlias, UserName;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct NativeAttribute
        {
            public string Keyword;
            public uint Flags, ValueSize;
            public IntPtr Value;
        }

        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
        [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredWrite(ref NativeCredential credential, uint flags);
        [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredDelete(string target, uint type, uint flags);
        [DllImport("advapi32.dll")]
        private static extern void CredFree(IntPtr buffer);

        public Credential Read()
        {
            IntPtr pointer;
            if (!CredRead(target, 1, 0, out pointer))
            {
                int error = Marshal.GetLastWin32Error();
                if (error == 1168) return null;
                throw new Win32Exception(error, "无法读取 Antigravity 登录凭据。");
            }
            try
            {
                NativeCredential c = (NativeCredential)Marshal.PtrToStructure(pointer, typeof(NativeCredential));
                var attributes = new List<CredentialAttribute>();
                int size = Marshal.SizeOf(typeof(NativeAttribute));
                for (int i = 0; i < c.AttributeCount; i++)
                {
                    var a = (NativeAttribute)Marshal.PtrToStructure(IntPtr.Add(c.Attributes, i * size), typeof(NativeAttribute));
                    attributes.Add(new CredentialAttribute { Keyword = a.Keyword, Flags = a.Flags, Value = Bytes(a.Value, a.ValueSize) });
                }
                return new Credential { Flags = c.Flags, Persist = c.Persist, UserName = c.UserName,
                    Comment = c.Comment, TargetAlias = c.TargetAlias, Blob = Bytes(c.Blob, c.BlobSize), Attributes = attributes.ToArray() };
            }
            finally { CredFree(pointer); }
        }

        private static byte[] Bytes(IntPtr pointer, uint length)
        {
            byte[] value = new byte[checked((int)length)];
            if (length > 0) Marshal.Copy(pointer, value, 0, value.Length);
            return value;
        }

        public void Write(Credential credential)
        {
            var allocations = new List<KeyValuePair<IntPtr, int>>();
            IntPtr attrs = IntPtr.Zero;
            int builtAttributes = 0;
            int size = Marshal.SizeOf(typeof(NativeAttribute));
            try
            {
                Func<byte[], IntPtr> allocate = delegate(byte[] bytes)
                {
                    IntPtr p = Marshal.AllocHGlobal(Math.Max(1, bytes.Length));
                    allocations.Add(new KeyValuePair<IntPtr, int>(p, bytes.Length));
                    if (bytes.Length > 0) Marshal.Copy(bytes, 0, p, bytes.Length);
                    return p;
                };
                var attributes = credential.Attributes ?? new CredentialAttribute[0];
                if (attributes.Length > 0)
                {
                    attrs = Marshal.AllocHGlobal(size * attributes.Length);
                    foreach (var a in attributes)
                    {
                        var native = new NativeAttribute { Keyword = a.Keyword, Flags = a.Flags,
                            Value = allocate(a.Value), ValueSize = (uint)a.Value.Length };
                        Marshal.StructureToPtr(native, IntPtr.Add(attrs, builtAttributes * size), false);
                        builtAttributes++;
                    }
                }
                var c = new NativeCredential { Flags = credential.Flags, Type = 1, TargetName = target,
                    Comment = credential.Comment, BlobSize = (uint)credential.Blob.Length, Blob = allocate(credential.Blob),
                    Persist = credential.Persist, AttributeCount = (uint)attributes.Length, Attributes = attrs,
                    TargetAlias = credential.TargetAlias, UserName = credential.UserName };
                if (!CredWrite(ref c, 0)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows 拒绝写入登录凭据。");
            }
            finally
            {
                for (int i = 0; i < builtAttributes; i++) Marshal.DestroyStructure(IntPtr.Add(attrs, i * size), typeof(NativeAttribute));
                if (attrs != IntPtr.Zero) Marshal.FreeHGlobal(attrs);
                foreach (var item in allocations)
                {
                    for (int i = 0; i < item.Value; i++) Marshal.WriteByte(item.Key, i, 0);
                    Marshal.FreeHGlobal(item.Key);
                }
            }
        }

        public void Delete()
        {
            if (!CredDelete(target, 1, 0) && Marshal.GetLastWin32Error() != 1168)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "无法恢复未登录状态。");
        }
    }

    public static class Json
    {
        public static string Stringify(object value) { return new JavaScriptSerializer().Serialize(value); }
        public static T Parse<T>(string value) { return new JavaScriptSerializer().Deserialize<T>(value); }
    }

    public sealed class AccountIdentity
    {
        public string Key { get; set; }
        public string Email { get; set; }
        public static AccountIdentity From(Credential credential)
        {
            if (credential == null) return null;
            try
            {
                var root = Json.Parse<Dictionary<string, object>>(Encoding.UTF8.GetString(credential.Blob));
                var token = root["token"] as Dictionary<string, object>;
                if (token == null || !token.ContainsKey("refresh_token") || string.IsNullOrWhiteSpace(token["refresh_token"] as string))
                    throw new FormatException();
                // Claims identify profiles locally only; they are not used as proof of authorization.
                string subject = null, email = null;
                object idToken;
                if (root.TryGetValue("id_token", out idToken) && idToken is string)
                {
                    var parts = ((string)idToken).Split('.');
                    if (parts.Length == 3)
                    {
                        string payload = parts[1].Replace('-', '+').Replace('_', '/');
                        payload = payload.PadRight((payload.Length + 3) / 4 * 4, '=');
                        var claims = Json.Parse<Dictionary<string, object>>(Encoding.UTF8.GetString(Convert.FromBase64String(payload)));
                        object value;
                        if (claims.TryGetValue("sub", out value)) subject = value as string;
                        if (claims.TryGetValue("email", out value)) email = value as string;
                    }
                }
                if (string.IsNullOrWhiteSpace(subject)) throw new FormatException();
                using (var sha = SHA256.Create())
                    return new AccountIdentity { Key = Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(subject))), Email = email ?? "邮箱不可用" };
            }
            catch { throw new InvalidOperationException("登录凭据格式不受支持，或缺少可恢复的 Google 登录信息。请先在 Antigravity 中重新登录个人账号。"); }
        }
    }
}
