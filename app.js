// app.js
const { ADMIN_TOKEN_KEY, CLOUD_ENV } = require('./utils/const');

App({
  onLaunch() {
    // 走微信云托管云调用时需要先初始化云能力（环境 ID 填云托管环境 ID）
    if (CLOUD_ENV && wx.cloud) {
      wx.cloud.init({ env: CLOUD_ENV, traceUser: false });
    }
  },

  onHide() {
    // 管理员页面打开时，离开小程序（切后台 / 关闭）即退出管理员身份，避免他人接着操作
    if (!this.globalData.adminPageOpen || this.globalData.adminGuard) return;
    this.globalData.adminPageOpen = false;
    wx.removeStorageSync(ADMIN_TOKEN_KEY);
  },

  globalData: {
    // 本地联调地址，部署后改成正式域名
    apiBaseUrl: 'http://127.0.0.1:3100',
    // 管理员改了换班 / 值班人员 / 导入后置为 true，值班表页据此刷新缓存
    rosterDirty: false,
    // 管理员页面是否在前台；为 true 时离开小程序会自动清掉管理员凭证
    adminPageOpen: false,
    // 选文件、预览 Excel 等系统页面期间暂停自动退出
    adminGuard: false,
  },
});
