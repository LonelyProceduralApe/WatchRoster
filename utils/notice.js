const api = require('./api');
const { ADMIN_TOKEN_KEY, USER_NAME_KEY } = require('./const');

function getAdminToken() {
  return wx.getStorageSync(ADMIN_TOKEN_KEY) || '';
}

function getUserName() {
  return wx.getStorageSync(USER_NAME_KEY) || '';
}

function isAdmin() {
  return Boolean(getAdminToken());
}

function setTabBadge(index, count) {
  if (count > 0) {
    wx.setTabBarBadge({
      index,
      text: count > 99 ? '99+' : String(count),
      fail() {},
    });
    return;
  }
  wx.removeTabBarBadge({ index, fail() {} });
}

/**
 * 拉取换班提醒：
 * - 管理员看全部待处理
 * - 普通人员看“别人要跟我换班”的待处理
 */
function refreshNotice() {
  const name = getUserName();
  return api
    .fetchSwapSummary(name)
    .then((summary) => {
      const admin = isAdmin();
      const count = admin ? summary.pendingTotal : summary.pendingAsTarget;
      setTabBadge(1, count);
      return { count, admin, name, summary };
    })
    .catch(() => {
      setTabBadge(1, 0);
      return { count: 0, admin: isAdmin(), name, summary: null };
    });
}

function clearTabBadge() {
  setTabBadge(1, 0);
}

module.exports = {
  getAdminToken,
  getUserName,
  isAdmin,
  refreshNotice,
  clearTabBadge,
  setTabBadge,
};
