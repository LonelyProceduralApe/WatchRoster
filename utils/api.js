const { ADMIN_TOKEN_KEY, API_BASE_KEY, CLOUD_ENV, CLOUD_SERVICE } = require('./const');

const DEFAULT_BASES = ['http://127.0.0.1:3100', 'http://localhost:3100'];

// 最近一次连通的地址，后续请求优先使用
let activeBase = '';

/** 配了云托管环境与服务名时，走 wx.cloud.callContainer（免域名白名单） */
function isCloud() {
  return Boolean(CLOUD_ENV && CLOUD_SERVICE && wx.cloud && wx.cloud.callContainer);
}

function describeBase() {
  return isCloud() ? '云托管 · ' + CLOUD_SERVICE : currentBase();
}

function requestHeader(config) {
  const header = { 'content-type': 'application/json' };
  if (config.admin) {
    const token = wx.getStorageSync(ADMIN_TOKEN_KEY);
    if (token) header['x-admin-token'] = token;
  }
  return header;
}

function handleResponse(res, resolve, reject) {
  if (res.statusCode >= 200 && res.statusCode < 300) {
    resolve(res.data);
    return;
  }
  if (res.statusCode === 401) wx.removeStorageSync(ADMIN_TOKEN_KEY);
  const error = res.data && res.data.error;
  reject(new Error((error && error.message) || '请求失败（' + res.statusCode + '）'));
}

function normalizeBase(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  const withScheme = /^https?:\/\//i.test(text) ? text : 'http://' + text;
  return withScheme.replace(/\/+$/, '');
}

function resolveBases() {
  const custom = normalizeBase(wx.getStorageSync(API_BASE_KEY));
  const app = typeof getApp === 'function' ? getApp() : null;
  const fromApp = normalizeBase(app && app.globalData && app.globalData.apiBaseUrl);
  const list = [activeBase, custom, fromApp, ...DEFAULT_BASES].filter(Boolean);
  return list.filter((item, index) => list.indexOf(item) === index);
}

function currentBase() {
  return resolveBases()[0] || DEFAULT_BASES[0];
}

function cloudRequest(path, options) {
  const config = options || {};
  const header = requestHeader(config);
  header['X-WX-SERVICE'] = CLOUD_SERVICE;

  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: CLOUD_ENV },
      path,
      method: config.method || 'GET',
      data: config.data || {},
      header,
      timeout: config.timeout || 15000,
      success(res) {
        handleResponse(res, resolve, reject);
      },
      fail(res) {
        const reason = (res && res.errMsg) || '调用失败';
        const error = new Error(
          '调用云托管服务失败（' + reason + '），请确认环境 ID、服务名与部署状态',
        );
        error.network = true;
        reject(error);
      },
    });
  });
}

function rawRequest(base, path, options) {
  const config = options || {};
  const header = requestHeader(config);

  return new Promise((resolve, reject) => {
    wx.request({
      url: base + path,
      method: config.method || 'GET',
      data: config.data || {},
      header,
      timeout: config.timeout || 15000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) activeBase = base;
        handleResponse(res, resolve, reject);
      },
      fail(res) {
        const reason = (res && res.errMsg) || '网络错误';
        const error = new Error(
          '连接 ' + base + ' 失败（' + reason + '）。请确认已在 server 目录执行 npm start',
        );
        error.network = true;
        error.base = base;
        reject(error);
      },
    });
  });
}

function request(path, options) {
  if (isCloud()) return cloudRequest(path, options);

  const bases = resolveBases();
  const attempt = (index) => {
    if (index >= bases.length) {
      return Promise.reject(new Error('没有可用的服务地址'));
    }
    return rawRequest(bases[index], path, options).catch((error) => {
      if (error.network && index + 1 < bases.length) return attempt(index + 1);
      throw error;
    });
  };
  return attempt(0);
}

function buildUrl(path, params) {
  const base = currentBase();
  if (!params) return base + path;
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => key + '=' + encodeURIComponent(params[key]))
    .join('&');
  return base + path + (query ? '?' + query : '');
}

/** 导出/模板：云调用下让服务端返回 base64，写成本地文件；HTTP 下直接下载 */
function downloadFile(path, params) {
  if (isCloud()) {
    const data = Object.assign({}, params, { format: 'base64' });
    return cloudRequest(path, { data, timeout: 60000 }).then((res) => {
      if (!res || !res.contentBase64) throw new Error('导出内容为空');
      const filePath = wx.env.USER_DATA_PATH + '/' + (res.fileName || 'export.xlsx');
      wx.getFileSystemManager().writeFileSync(filePath, res.contentBase64, 'base64');
      return filePath;
    });
  }

  const url = buildUrl(path, params);
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success(res) {
        if (res.statusCode !== 200) {
          reject(new Error('服务返回 ' + res.statusCode));
          return;
        }
        resolve(res.tempFilePath);
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '下载失败'));
      },
    });
  });
}

module.exports = {
  currentBase,
  describeBase,
  isCloud,
  buildUrl,
  downloadFile,

  setBase(url) {
    const normalized = normalizeBase(url);
    if (normalized) {
      wx.setStorageSync(API_BASE_KEY, normalized);
      activeBase = normalized;
    } else {
      wx.removeStorageSync(API_BASE_KEY);
      activeBase = '';
    }
    return normalized;
  },

  ping() {
    return request('/api/health');
  },

  fetchRoster(startDate, endDate) {
    return request('/api/roster', { data: { startDate, endDate } });
  },

  fetchConfig() {
    return request('/api/config');
  },

  /* 换班 */
  createSwap(payload) {
    return request('/api/swaps', { method: 'POST', data: payload });
  },

  fetchSwaps(name) {
    return request('/api/swaps', { data: name ? { name } : {} });
  },

  fetchSwapSummary(name) {
    return request('/api/swaps/summary', { data: name ? { name } : {} });
  },

  cancelSwap(id, name) {
    return request('/api/swaps/' + id + '/cancel', { method: 'POST', data: { name } });
  },

  /* 管理员 */
  adminLogin(password) {
    return request('/api/admin/login', { method: 'POST', data: { password } });
  },

  adminLogout() {
    return request('/api/admin/logout', { method: 'POST', admin: true });
  },

  adminSwaps(status) {
    return request('/api/admin/swaps', { admin: true, data: status ? { status } : {} });
  },

  handleAdminSwap(id, action) {
    return request('/api/admin/swaps/' + id + '/' + action, { method: 'POST', admin: true });
  },

  deleteAdminSwap(id) {
    return request('/api/admin/swaps/' + id, { method: 'DELETE', admin: true });
  },

  adminSettings() {
    return request('/api/admin/settings', { admin: true });
  },

  saveGroups(groups) {
    return request('/api/admin/groups', { method: 'PUT', data: { groups }, admin: true });
  },

  saveLeave(payload) {
    return request('/api/admin/leave', { method: 'PUT', data: payload, admin: true });
  },

  saveSchedule(payload) {
    return request('/api/admin/schedule', { method: 'PUT', data: payload, admin: true });
  },

  fetchAssignments() {
    return request('/api/admin/assignments', { admin: true });
  },

  saveAssignment(payload) {
    return request('/api/admin/assignments', { method: 'PUT', data: payload, admin: true });
  },

  deleteAssignment(date) {
    return request('/api/admin/assignments/' + date, { method: 'DELETE', admin: true });
  },

  importRoster(fileName, contentBase64) {
    return request('/api/admin/import', {
      method: 'POST',
      data: { fileName, contentBase64 },
      admin: true,
      timeout: 60000,
    });
  },
};
