import { openSync, closeSync, lstatSync, fstatSync, readSync, constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

const refuse = (code = 'GORIQ_FRIEND_CONFIG_INVALID') => { throw Error(code); };
const privatePath = value => typeof value === 'string' && value === value.trim() &&
  !/[\r\n\0]/u.test(value) && isAbsolute(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function readJSON(file) {
  let fd;
  try {
    if (!privatePath(file)) refuse();
    const before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink()) refuse();
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size > 16384 || before.dev !== opened.dev || before.ino !== opened.ino) refuse();
    const buffer = Buffer.alloc(16385);
    let length = 0, count;
    while (length < buffer.length && (count = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += count;
    if (length > 16384) refuse();
    return JSON.parse(buffer.subarray(0, length).toString('utf8'));
  } catch { refuse(); }
  finally { if (fd !== undefined) closeSync(fd); }
}

function hostname(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048) refuse();
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password ||
        !/^[a-z0-9.-]+$/u.test(url.hostname)) refuse();
    return url.hostname.replace(/\.$/u, '');
  } catch { refuse('GORIQ_FRIEND_ORIGIN_INVALID'); }
}

/** Read in the actual serving child. The returned config object is the one used
 * by the HTTPS portal, so a parent's earlier check cannot authorize another file. */
export function readGoriqHostedPortalConfig(wrapperPath) {
  const wrapper = readJSON(wrapperPath);
  if (!record(wrapper) || Object.keys(wrapper).sort().join(',') !== 'ownerOrigins,portalConfig,version' ||
      wrapper.version !== 1 || !privatePath(wrapper.portalConfig) || !Array.isArray(wrapper.ownerOrigins) ||
      !wrapper.ownerOrigins.length || wrapper.ownerOrigins.length > 20 ||
      new Set(wrapper.ownerOrigins).size !== wrapper.ownerOrigins.length) refuse();
  const ownerHosts = wrapper.ownerOrigins.map(hostname);
  const config = readJSON(wrapper.portalConfig);
  if (!record(config)) refuse();
  if (ownerHosts.includes(hostname(config.origin))) refuse('GORIQ_FRIEND_HOSTNAME_CONFLICT');
  return { configPath: wrapper.portalConfig, config };
}
