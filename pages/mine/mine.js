const notice = require('../../utils/notice');
const api = require('../../utils/api');

Page({
  data: {
    version: 'v1.0.0',
    name: '',
    avatarText: '值',
    isAdmin: false,
    mySwapCount: 0,
    adminSwapCount: 0,
    apiBase: '',
  },

  onShow() {
    this.setData({ apiBase: api.describeBase() });
    this.refresh();
  },

  refresh() {
    const name = notice.getUserName();
    const admin = notice.isAdmin();
    this.setData({
      name,
      avatarText: name ? name.slice(0, 1) : '值',
      isAdmin: admin,
    });

    notice.refreshNotice().then((res) => {
      const summary = res.summary || {};
      this.setData({
        mySwapCount: summary.pendingAsTarget || 0,
        adminSwapCount: admin ? summary.pendingTotal || 0 : 0,
      });
    });
  },

  onApplySwap() {
    wx.navigateTo({ url: '/pages/swap/swap' });
  },

  onAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  onProfileTap() {
    if (!this.data.name) {
      wx.showToast({ title: '在“申请换班”里选择你的姓名', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/swap/swap' });
  },

  /* ---------- 服务地址与连接自检 ---------- */
  onPing() {
    wx.showLoading({ title: '检测中', mask: true });
    api
      .ping()
      .then((res) => {
        wx.hideLoading();
        wx.showModal({
          title: '连接正常',
          content: '地址：' + api.describeBase() + '\n服务：' + (res.service || 'roster'),
          showCancel: false,
        });
        this.setData({ apiBase: api.describeBase() });
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showModal({ title: '连接失败', content: error.message, showCancel: false });
      });
  },

  onEditBase() {
    if (api.isCloud()) {
      wx.showModal({
        title: '已启用云托管',
        content: '服务地址由 utils/const.js 里的 CLOUD_ENV / CLOUD_SERVICE 决定，不需要手工填写。',
        showCancel: false,
      });
      return;
    }
    wx.showModal({
      title: '服务地址',
      editable: true,
      content: api.currentBase(),
      placeholderText: 'http://192.168.1.5:3100',
      success: (res) => {
        if (!res.confirm) return;
        api.setBase(res.content || '');
        this.setData({ apiBase: api.currentBase() });
        wx.showToast({ title: '已保存', icon: 'none' });
      },
    });
  },
});
