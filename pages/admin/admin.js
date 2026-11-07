const api = require('../../utils/api');
const dateUtil = require('../../utils/date');
const { ADMIN_TOKEN_KEY } = require('../../utils/const');
const notice = require('../../utils/notice');

const SECTIONS = [
  { key: 'swaps', label: '换班' },
  { key: 'groups', label: '分组' },
  { key: 'staff', label: '排班' },
  { key: 'import', label: '导入' },
];

const STATUS_LABELS = {
  pending: '待处理',
  approved: '已批准',
  rejected: '已驳回',
  cancelled: '已撤销',
};

const BACKUP_LINES = [
  { key: 'workday', label: '工作日' },
  { key: 'weekend', label: '周末' },
  { key: 'holiday', label: '节假日' },
];

function createBackupLines() {
  return BACKUP_LINES.map((line) => ({
    key: line.key,
    label: line.label,
    anchorDate: '',
    startGroup: 1,
    startIndex: 0,
  }));
}

function markDirty() {
  const app = getApp();
  if (app && app.globalData) app.globalData.rosterDirty = true;
}

Page({
  data: {
    authed: false,
    password: '',
    logging: false,
    error: '',

    sections: SECTIONS,
    activeSection: 'swaps',

    requests: [],
    pendingCount: 0,
    loadingSwaps: false,
    // 换班请求左滑删除
    swipeId: '',
    swipeX: 0,
    dragging: false,

    groups: [],
    leaveHint: '全部正常',
    queueText: '',
    groupSaving: false,

    groupOptions: [],
    backupOptions: [],
    backupLines: createBackupLines(),
    lines: [
      { key: 'workday', label: '工作日', hint: '每 5 个工作日一块', anchorDate: '', startGroup: 1 },
      { key: 'weekend', label: '周末', hint: '按 1→10 循环', anchorDate: '', startGroup: 1 },
      { key: 'holiday', label: '节假日', hint: '按 1→10 循环', anchorDate: '', startGroup: 1 },
    ],
    scheduleSaving: false,
    exportMonth: '',

    today: '',
    maxDate: '',
    assignDate: '',
    assignBackup: '',
    assignDuty: '',
    assignStaff: '',
    assignInfo: null,
    assignSaving: false,

    importing: false,
    importResult: null,
    importError: '',
  },

  onLoad() {
    const today = dateUtil.todayKey();
    const now = new Date();
    const exportMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    this.setData({
      today,
      maxDate: dateUtil.addDays(today, 180),
      assignDate: today,
      exportMonth,
    });
    if (notice.getAdminToken()) {
      this.setData({ authed: true });
      this.loadShell();
    }
  },

  onShow() {
    const app = getApp();
    if (app && app.globalData) app.globalData.adminPageOpen = true;

    // 从小程序后台回到前台时，凭证可能已被 app.onHide 清掉
    if (this.data.authed && !notice.getAdminToken()) {
      this.setData({
        authed: false,
        password: '',
        requests: [],
        importResult: null,
        importError: '',
        error: '',
      });
      return;
    }
    if (this.data.authed) notice.refreshNotice();
  },

  onUnload() {
    const app = getApp();
    if (app && app.globalData) app.globalData.adminPageOpen = false;
    // 返回其他页面即退出管理员
    this.autoLogout();
  },

  /** 离开页面 / 退出小程序时自动退出管理员身份 */
  autoLogout() {
    if (!notice.getAdminToken()) return;
    api.adminLogout().catch(() => {});
    wx.removeStorageSync(ADMIN_TOKEN_KEY);
    notice.clearTabBadge();
    this.setData({
      authed: false,
      password: '',
      requests: [],
      importResult: null,
      importError: '',
      error: '',
    });
  },

  /** 选文件 / 预览文档期间暂停 app.onHide 的自动退出 */
  setGuard(value) {
    const app = getApp();
    if (app && app.globalData) app.globalData.adminGuard = value;
  },

  /* ---------- 验证 ---------- */
  onPasswordInput(event) {
    this.setData({ password: event.detail.value, error: '' });
  },

  login() {
    if (this.data.logging) return;
    if (!this.data.password) {
      wx.showToast({ title: '请输入管理员密码', icon: 'none' });
      return;
    }
    this.setData({ logging: true, error: '' });
    api
      .adminLogin(this.data.password)
      .then((session) => {
        wx.setStorageSync(ADMIN_TOKEN_KEY, session.token);
        this.setData({ authed: true, logging: false, password: '' });
        wx.showToast({ title: '验证通过', icon: 'success' });
        this.loadShell();
      })
      .catch((error) => this.setData({ logging: false, error: error.message }));
  },

  logout() {
    api
      .adminLogout()
      .catch(() => {})
      .then(() => {
        wx.removeStorageSync(ADMIN_TOKEN_KEY);
        this.setData({ authed: false, requests: [], importResult: null, error: '' });
        notice.clearTabBadge();
        wx.showToast({ title: '已退出', icon: 'success' });
      });
  },

  /* ---------- 分栏 ---------- */
  onSectionChange(event) {
    this.setData({ activeSection: event.currentTarget.dataset.key });
  },

  loadShell() {
    this.loadRequests();
    this.loadGroups();
    this.loadAssignment(this.data.assignDate);
    notice.refreshNotice();
  },

  /* ---------- 分组人员与请假 ---------- */
  loadGroups() {
    api
      .adminSettings()
      .then((res) => {
        const leaveGroups = (res.substitution && res.substitution.leaveGroups) || [];
        const raw = (res.groups && res.groups.groups) || [];
        const groups = raw
          .slice()
          .sort((a, b) => a.no - b.no)
          .map((group) => ({
            no: group.no,
            name: group.name || '第' + group.no + '组',
            backupLeader: group.backupLeader || '',
            dutyLeader: group.dutyLeader || '',
            staff: (Array.isArray(group.staff) ? group.staff : []).map((name, index) => ({
              id: 'g' + group.no + '-' + index,
              name,
            })),
            leave: leaveGroups.indexOf(group.no) >= 0,
          }));
        const substitution = res.substitution || {};
        const schedule = res.schedule || {};
        const groupOptions = [];
        for (let no = 1; no <= 10; no += 1) {
          groupOptions.push({ value: no, label: '第' + no + '组' });
        }

        // 代班队列 = 1-10 中未请假的组，按组号顺序轮转
        const queue = groupOptions
          .map((item) => item.value)
          .filter((no) => leaveGroups.indexOf(no) < 0);
        const backupOptions = queue.map((no) => ({ value: no, label: '第' + no + '组' }));
        const defaultStart = backupOptions.length ? backupOptions[0].value : 1;
        const startGroups = substitution.startGroups || {};
        const rotationStarts = substitution.rotationStarts || {};
        const backupLines = BACKUP_LINES.map((line) => {
          const wanted =
            startGroups[line.key] !== undefined
              ? Number(startGroups[line.key])
              : Number(substitution.startGroup) || defaultStart;
          const found = backupOptions.findIndex((item) => item.value === wanted);
          const startIndex = found >= 0 ? found : 0;
          return {
            key: line.key,
            label: line.label,
            anchorDate: rotationStarts[line.key] || substitution.rotationStart || '',
            startGroup: backupOptions.length ? backupOptions[startIndex].value : defaultStart,
            startIndex,
          };
        });

        // 兼容旧配置里的统一起排日期
        const legacyAnchor = schedule.anchorDate || '';

        this.setData({
          groups,
          queueText: queue.join('、'),
          groupOptions,
          backupOptions,
          backupLines,
          lines: [
            {
              key: 'workday',
              label: '工作日',
              hint: '每 5 个工作日一块',
              anchorDate: schedule.workdayAnchorDate || legacyAnchor || '',
              startGroup: schedule.workdayStartGroup || 1,
            },
            {
              key: 'weekend',
              label: '周末',
              hint: '按 1→10 循环',
              anchorDate: schedule.weekendAnchorDate || legacyAnchor || '',
              startGroup: schedule.weekendStartGroup || 1,
            },
            {
              key: 'holiday',
              label: '节假日',
              hint: '按 1→10 循环',
              anchorDate: schedule.holidayAnchorDate || legacyAnchor || '',
              startGroup: schedule.holidayStartGroup || 1,
            },
          ],
        });
        this.refreshLeaveHint();
      })
      .catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
  },

  refreshLeaveHint() {
    const names = this.data.groups.filter((group) => group.leave).map((group) => group.name);
    this.setData({ leaveHint: names.length ? '请假：' + names.join('、') : '全部正常' });
  },

  onGroupField(event) {
    const { index, field } = event.currentTarget.dataset;
    this.setData({ ['groups[' + index + '].' + field]: event.detail.value });
  },

  onStaffInput(event) {
    const { gi, si } = event.currentTarget.dataset;
    this.setData({ ['groups[' + gi + '].staff[' + si + '].name']: event.detail.value });
  },

  onStaffAdd(event) {
    const gi = Number(event.currentTarget.dataset.gi);
    const staff = this.data.groups[gi].staff.concat({
      id: 'n' + Date.now() + '-' + gi,
      name: '',
    });
    this.setData({ ['groups[' + gi + '].staff']: staff });
  },

  onStaffDelete(event) {
    const gi = Number(event.currentTarget.dataset.gi);
    const si = Number(event.currentTarget.dataset.si);
    const staff = this.data.groups[gi].staff.filter((item, index) => index !== si);
    this.setData({ ['groups[' + gi + '].staff']: staff });
  },

  onSaveGroups() {
    if (this.data.groupSaving) return;
    const payload = this.data.groups.map((group) => ({
      no: group.no,
      name: group.name,
      backupLeader: group.backupLeader.trim(),
      dutyLeader: group.dutyLeader.trim(),
      staff: group.staff
        .map((item) => item.name.trim())
        .filter(Boolean),
    }));

    this.setData({ groupSaving: true });
    api
      .saveGroups(payload)
      .then(() => {
        this.setData({ groupSaving: false });
        markDirty();
        wx.showToast({ title: '已保存', icon: 'success' });
        this.loadGroups();
        this.loadAssignment(this.data.assignDate);
      })
      .catch((error) => {
        this.setData({ groupSaving: false });
        wx.showToast({ title: error.message, icon: 'none' });
      });
  },

  onToggleLeave(event) {
    const gi = Number(event.currentTarget.dataset.index);
    this.setData({ ['groups[' + gi + '].leave']: event.detail.value });
    this.refreshLeaveHint();
    this.saveLeave();
  },

  saveLeave() {
    const leaveGroups = this.data.groups
      .filter((group) => group.leave)
      .map((group) => group.no);

    api
      .saveLeave({ leaveGroups })
      .then(() => markDirty())
      .catch((error) => {
        wx.showToast({ title: error.message, icon: 'none' });
        this.loadGroups();
      });
  },

  /* ---------- 换班请求 ---------- */
  loadRequests() {
    this.setData({ loadingSwaps: true });
    api
      .adminSwaps()
      .then((res) => {
        const requests = (res.requests || []).map((item) => ({
          id: item.id,
          status: item.status,
          statusLabel: STATUS_LABELS[item.status] || item.status,
          requesterName: item.requester.name,
          requesterDate: item.requester.date,
          requesterRole: item.requester.roleLabel || '',
          targetName: item.target.name,
          targetDate: item.target.date,
          targetRole: item.target.roleLabel || '',
          reason: item.reason || '',
          createdAt: String(item.createdAt || '').slice(0, 16).replace('T', ' '),
          pending: item.status === 'pending',
        }));
        const pendingCount = res.summary ? res.summary.pendingTotal : 0;
        this.setData({
          loadingSwaps: false,
          requests,
          pendingCount,
          swipeId: '',
          swipeX: 0,
          dragging: false,
        });
        notice.setTabBadge(1, pendingCount);
      })
      .catch((error) => this.setData({ loadingSwaps: false, error: error.message }));
  },

  onApprove(event) {
    this.handleSwap(event.currentTarget.dataset.id, 'approve');
  },

  onReject(event) {
    this.handleSwap(event.currentTarget.dataset.id, 'reject');
  },

  handleSwap(id, action) {
    wx.showLoading({ title: '处理中', mask: true });
    api
      .handleAdminSwap(id, action)
      .then(() => {
        wx.hideLoading();
        markDirty();
        wx.showToast({ title: action === 'approve' ? '已批准，值班表已更新' : '已驳回', icon: 'none' });
        this.loadRequests();
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showToast({ title: error.message, icon: 'none' });
      });
  },

  /* ---------- 换班请求左滑删除 ---------- */
  swipeWidth() {
    // 与 wxss 中 .req-delete 的 168rpx 对应
    if (!this.deleteWidth) {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.deleteWidth = Math.round((info.windowWidth * 168) / 750);
    }
    return this.deleteWidth;
  },

  onRequestTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const id = event.currentTarget.dataset.id;
    this.dragState = {
      id,
      startX: touch.clientX,
      startY: touch.clientY,
      base: this.data.swipeId === id ? this.data.swipeX : 0,
      locked: false,
      active: true,
    };
  },

  onRequestTouchMove(event) {
    const state = this.dragState;
    if (!state || !state.active) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;

    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    if (!state.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // 竖向手势交给页面滚动
      if (Math.abs(dy) > Math.abs(dx)) {
        state.active = false;
        return;
      }
      state.locked = true;
    }

    const limit = this.swipeWidth();
    const offset = Math.max(-limit, Math.min(0, state.base + dx));
    this.setData({ swipeId: state.id, swipeX: offset, dragging: true });
  },

  onRequestTouchEnd() {
    const state = this.dragState;
    this.dragState = null;
    if (!state || !state.locked) {
      // 轻触已展开的卡片时收起
      if (state && this.data.swipeId === state.id) {
        this.setData({ swipeId: '', swipeX: 0, dragging: false });
        return;
      }
      this.setData({ dragging: false });
      return;
    }

    const limit = this.swipeWidth();
    const open = this.data.swipeX <= -limit / 2;
    this.setData({
      swipeId: open ? state.id : '',
      swipeX: open ? -limit : 0,
      dragging: false,
    });
  },

  onDeleteRequest(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: '删除换班申请',
      content: '删除后不可恢复。已批准的申请删除后，对应的换班也会恢复原样。',
      confirmText: '删除',
      confirmColor: '#e54d42',
      success: (res) => {
        if (!res.confirm) return;
        api
          .deleteAdminSwap(id)
          .then(() => {
            markDirty();
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadRequests();
          })
          .catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
      },
    });
  },

  /* ---------- 起排设置（三条序列各自独立） ---------- */
  onAnchorChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ ['lines[' + index + '].anchorDate']: event.detail.value });
  },

  onStartGroupChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    const option = this.data.groupOptions[Number(event.detail.value)];
    if (!option) return;
    this.setData({ ['lines[' + index + '].startGroup']: option.value });
  },

  onBackupAnchorChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ ['backupLines[' + index + '].anchorDate']: event.detail.value });
  },

  onBackupStartChange(event) {
    const lineIndex = Number(event.currentTarget.dataset.index);
    const optionIndex = Number(event.detail.value);
    const option = this.data.backupOptions[optionIndex];
    if (!option) return;
    this.setData({
      ['backupLines[' + lineIndex + '].startIndex']: optionIndex,
      ['backupLines[' + lineIndex + '].startGroup']: option.value,
    });
  },

  onSaveSchedule() {
    if (this.data.scheduleSaving) return;

    const lines = this.data.lines;
    const missing = lines.filter((line) => !line.anchorDate)[0];
    if (missing) {
      wx.showToast({ title: '请选择' + missing.label + '起排日期', icon: 'none' });
      return;
    }

    const payload = {};
    lines.forEach((line) => {
      payload[line.key + 'AnchorDate'] = line.anchorDate;
      payload[line.key + 'StartGroup'] = line.startGroup;
    });
    const rotationStarts = {};
    const startGroups = {};
    this.data.backupLines.forEach((line) => {
      rotationStarts[line.key] = line.anchorDate || null;
      startGroups[line.key] = line.startGroup;
    });
    payload.substitutionRotationStarts = rotationStarts;
    payload.substitutionStartGroups = startGroups;

    this.setData({ scheduleSaving: true });
    api
      .saveSchedule(payload)
      .then(() => {
        this.setData({ scheduleSaving: false });
        markDirty();
        wx.showToast({ title: '已保存，排班已重算', icon: 'none' });
        this.loadAssignment(this.data.assignDate);
      })
      .catch((error) => {
        this.setData({ scheduleSaving: false });
        wx.showToast({ title: error.message, icon: 'none' });
      });
  },

  /* ---------- 值班人员设置 ---------- */
  onAssignDateChange(event) {
    this.setData({ assignDate: event.detail.value });
    this.loadAssignment(event.detail.value);
  },

  loadAssignment(key) {
    api
      .fetchRoster(key, key)
      .then((roster) => {
        const day = roster.days && roster.days[0];
        if (!day) return;
        this.setData({
          assignBackup: day.backupLeader || '',
          assignDuty: day.dutyLeader || '',
          assignStaff: day.staffText || '',
          assignInfo: {
            groupName: day.groupName,
            weekday: day.weekday,
            dayTypeLabel: day.dayTypeLabel,
            manual: Boolean(day.manual),
            swapped: Boolean(day.swapped),
            note: day.note || '',
          },
        });
      })
      .catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
  },

  onBackupInput(event) {
    this.setData({ assignBackup: event.detail.value });
  },

  onDutyInput(event) {
    this.setData({ assignDuty: event.detail.value });
  },

  onAssignStaffInput(event) {
    this.setData({ assignStaff: event.detail.value });
  },

  saveAssignment() {
    if (this.data.assignSaving) return;
    const staff = this.data.assignStaff
      .split(/[、,，\s]+/)
      .map((name) => name.trim())
      .filter(Boolean);

    this.setData({ assignSaving: true });
    api
      .saveAssignment({
        date: this.data.assignDate,
        backupLeader: this.data.assignBackup.trim(),
        dutyLeader: this.data.assignDuty.trim(),
        staff,
      })
      .then(() => {
        this.setData({ assignSaving: false });
        markDirty();
        wx.showToast({ title: '已保存', icon: 'success' });
        this.loadAssignment(this.data.assignDate);
      })
      .catch((error) => {
        this.setData({ assignSaving: false });
        wx.showToast({ title: error.message, icon: 'none' });
      });
  },

  resetAssignment() {
    api
      .deleteAssignment(this.data.assignDate)
      .then(() => {
        markDirty();
        wx.showToast({ title: '已恢复自动排班', icon: 'success' });
        this.loadAssignment(this.data.assignDate);
      })
      .catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
  },

  /* ---------- 导入 Excel ---------- */
  chooseFile() {
    if (this.data.importing) return;
    // 跳到微信的选文件页面时先暂停「自动退出管理员」
    this.setGuard(true);
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (file) this.uploadFile(file);
      },
      fail() {},
      complete: () => this.setGuard(false),
    });
  },

  uploadFile(file) {
    this.setData({ importing: true, importError: '', importResult: null });
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: file.path,
      encoding: 'base64',
      success: (res) => {
        api
          .importRoster(file.name || 'roster.xlsx', res.data)
          .then((result) => {
            this.setData({ importing: false, importResult: result });
            markDirty();
            wx.showToast({ title: '导入成功', icon: 'success' });
            this.loadAssignment(this.data.assignDate);
          })
          .catch((error) => this.setData({ importing: false, importError: error.message }));
      },
      fail: (err) =>
        this.setData({
          importing: false,
          importError: '读取文件失败：' + (err.errMsg || '未知错误'),
        }),
    });
  },

  /* ---------- 导出 ---------- */
  onExportMonthChange(event) {
    this.setData({ exportMonth: event.detail.value });
  },

  onExportTemplate() {
    this.downloadAndOpen('/api/roster/template', null, '模板导出失败');
  },

  onExportRoster() {
    const parts = String(this.data.exportMonth).split('-');
    this.downloadAndOpen(
      '/api/roster/export',
      { year: Number(parts[0]), month: Number(parts[1]) },
      '排班表导出失败',
    );
  },

  downloadAndOpen(path, params, failTitle) {
    wx.showLoading({ title: '生成中', mask: true });
    api
      .downloadFile(path, params)
      .then((filePath) => {
        wx.hideLoading();
        // 预览文档会切到微信的文档页面，期间同样暂停「自动退出管理员」
        this.setGuard(true);
        wx.openDocument({
          filePath,
          fileType: 'xlsx',
          showMenu: true,
          fail: () =>
            wx.showToast({ title: '无法预览，可用右上角菜单转发到电脑打开', icon: 'none' }),
          complete: () => this.setGuard(false),
        });
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showModal({ title: failTitle, content: error.message || '网络错误', showCancel: false });
      });
  },
});
