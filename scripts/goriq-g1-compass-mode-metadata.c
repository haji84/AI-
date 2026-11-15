/* Read-only Darwin descriptor metadata. Compile against the installed SDK;
 * no guessed stat/ACL ABI and no permission mutation in this shim. */
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/acl.h>
#include <sys/xattr.h>
#include <sys/param.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>

/* 0 empty, 1 deny-only, 2 contains an allow, -1 unavailable. Successful
 * fstatx_np + filesec query distinguishes absence from acl_get_fd errors. */
int g1_fd_acl(int fd) {
    struct stat value;
    filesec_t security = filesec_init();
    acl_t acl = NULL;
    int present = 0, result = -1;
    if (!security) return -1;
    if (fstatx_np(fd, &value, security) != 0 ||
        filesec_query_property(security, FILESEC_ACL, &present) != 0) goto done;
    if (!present) { result = 0; goto done; }
    if (filesec_get_property(security, FILESEC_ACL, &acl) != 0 ||
        !acl || acl_valid(acl) != 0) goto done;
    result = 0;
    for (int index = 0; index <= 128; ++index) {
        acl_entry_t entry = NULL;
        errno = 0;
        int code = acl_get_entry(acl, index == 0 ? ACL_FIRST_ENTRY : ACL_NEXT_ENTRY, &entry);
        if (code == -1 && errno == EINVAL) goto done;
        if (code != 0 || !entry || index == 128) { result = -1; goto done; }
        acl_tag_t tag;
        if (acl_get_tag_type(entry, &tag) != 0) { result = -1; goto done; }
        if (tag == ACL_EXTENDED_ALLOW) { result = 2; goto done; }
        if (tag != ACL_EXTENDED_DENY) { result = -1; goto done; }
        result = 1;
    }
done:
    if (acl) acl_free(acl);
    filesec_free(security);
    return result;
}

int g1_fd_path(int fd, char *output, unsigned long capacity) {
    if (!output || capacity < MAXPATHLEN) return -1;
    memset(output, 0, capacity);
    return fcntl(fd, F_GETPATH, output);
}

/* Finder alias files are regular files; do not confuse them with a DB leaf. */
int g1_fd_alias(int fd) {
    unsigned char info[32];
    errno = 0;
    ssize_t length = fgetxattr(fd, "com.apple.FinderInfo", info, sizeof(info), 0, 0);
    if (length == -1 && errno == ENOATTR) return 0;
    if (length != (ssize_t)sizeof(info)) return -1;
    return (info[8] & 0x80) ? 1 : 0;
}
