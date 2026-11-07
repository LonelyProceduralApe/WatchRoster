const api = require('../../utils/api');
const dateUtil = require('../../utils/date');
const { USER_NAME_KEY } = require('../../utils/const');
const notice = require('../../utils/notice');

function roleOf(day, name) {
  if (!day || !name) return null;
  if (day.backupLeader === name) return { role: 'backupLeader', label: '带班领导' };
  if (day.dutyLeader === name) return { role: 'dutyLeader', label: '值班领导' };
  if ((day.staff || []).indexOf(name) >= 0) return { role: 'staff', label: '工作人员' };
  return null;
}

function candidatesOf(day) {
  const list = [];
  if (day.backupLeader) list.push({ name: day.backupLeader, role: 'backupLeader', roleLabel: '带班领导' });
  if (day.dutyLeader) list.push({ name: day.dutyLeader, role: 'dutyLeader', roleLabel: '值班领导' });
  (day.staff || []).forEach((name) => list.push({ name, role: 'staff', roleLabel: '工作人员' }));
  return list;
}

Page({
  data: {
    today: '',
    maxDate: '',
    personnel: [],
    myNameIndex: -1,
    myName: '',
    outDate: '',
    outDay: null,
    outRole: '',
    outRoleLabel: '',
    targetDate: '',
    targetDay: null,
    targetCandidates: [],
    targetIndex: -1,
    targetName: '',
    targetRole: '',
    targetRoleLabel: '',
    reason: '',
    submitting: false,
    loading: false,
    error: '',
  },

  onLoad() {
    const today = dateUtil.todayKey();
    this.setData({
      today,
      maxDate: dateUtil.addDays(today, 90),
      outDate: today,
      targetDate: dateUtil.addDays(today, 1),
      myName: wx.getStorageSync(USER_NAME_KEY) || '',
    });
    this.loadPersonnel();
  },

  onShow() {
    notice.refreshNotice();
  },

  loadPersonnel() {
    api
      .fetchConfig()
      .then((config) => {
        const map = new Map();
        const groups = (config.groups && config.groups.groups) || [];
        for (const group of groups) {
          const push = (name, roleLabel) => {
            if (!name || map.has(name)) return;
            map.set(name, {
              name,
              groupNo: group.no,
              roleLabel,
              label: name + '（' + group.name + roleLabel + '）',
            });
          };
          push(group.backupLeader, '带班领导');
          push(group.dutyLeader, '值班领导');
          (group.staff || []).forEach((name) => push(name, '工作人员'));
        }
        const personnel = [...map.values()];
        const myNameIndex = personnel.findIndex((item) => item.name === this.data.myName);
        this.setData({ personnel, myNameIndex });
        if (this.data.myName) this.loadDay(this.data.outDate, 'out');
        this.loadDay(this.data.targetDate, 'target');
      })
      .catch((error) => this.setData({ error: error.message }));
  },

  onNameChange(event) {
    const person = this.data.personnel[Number(event.detail.value)];
    if (!person) return;
    this.setData({ myNameIndex: Number(event.detail.value), myName: person.name });
    wx.setStorageSync(USER_NAME_KEY, person.name);
    if (this.data.outDay) this.loadDay(this.data.outDate, 'out');
  },

  onOutDateChange(event) {
    this.setData({ outDate: event.detail.value });
    this.loadDay(event.detail.value, 'out');
  },

  onTargetDateChange(event) {
    this.setData({ targetDate: event.detail.value, targetIndex: -1, targetName: '', targetRole: '' });
    this.loadDay(event.detail.value, 'target');
  },

  loadDay(key, side) {
    this.setData({ loading: true, error: '' });
    api
      .fetchRoster(key, key)
      .then((roster) => {
        const day = roster.days && roster.days[0];
        if (!day) return;
        const view = {
          date: day.date,
          dateLabel: dateUtil.monthDay(day.date),
          weekday: day.weekday,
          dayTypeLabel: day.dayTypeLabel,
          groupNo: day.groupNo,
          groupName: day.groupName,
          backupLeader: day.backupLeader || '未配置',
          dutyLeader: day.dutyLeader || '未配置',
          staffText: day.staffText || '未配置',
        };

        if (side === 'out') {
          const matched = roleOf(day, this.data.myName);
          this.setData({
            loading: false,
            outDay: view,
            outRole: matched ? matched.role : '',
            outRoleLabel: matched ? matched.label : '',
          });
          return;
        }

        const candidates = candidatesOf(day)
          .filter((item) => item.name !== this.data.myName)
          .map((item) => ({ ...item, label: item.name + '（' + item.roleLabel + '）' }));

        this.setData({
          loading: false,
          targetDay: view,
          targetCandidates: candidates,
          targetIndex: -1,
          targetName: '',
          targetRole: '',
          targetRoleLabel: '',
        });
      })
      .catch((error) => this.setData({ loading: false, error: error.message }));
  },

  onTargetChange(event) {
    const item = this.data.targetCandidates[Number(event.detail.value)];
    if (!item) return;
    this.setData({
      targetIndex: Number(event.detail.value),
      targetName: item.name,
      targetRole: item.role,
      targetRoleLabel: item.roleLabel,
    });
  },

  onReasonInput(event) {
    this.setData({ reason: event.detail.value });
  },

  submit() {
    if (this.data.submitting) return;
    const { myName, outDate, outRole, outDay, targetDate, targetName, targetRole, targetDay } =
      this.data;

    if (!myName) return wx.showToast({ title: '请先选择你是谁', icon: 'none' });
    if (!outDay) return wx.showToast({ title: '请选择换出日期', icon: 'none' });
    if (!outRole) return wx.showToast({ title: '你在该日期没有值班安排', icon: 'none' });
    if (!targetDay) return wx.showToast({ title: '请选择换班对象日期', icon: 'none' });
    if (!targetName) return wx.showToast({ title: '请选择换班对象', icon: 'none' });
    if (outDate === targetDate) return wx.showToast({ title: '两个日期不能相同', icon: 'none' });

    this.setData({ submitting: true });
    api
      .createSwap({
        requester: { name: myName, date: outDate, role: outRole, groupNo: outDay.groupNo },
        target: { name: targetName, date: targetDate, role: targetRole, groupNo: targetDay.groupNo },
        reason: this.data.reason,
      })
      .then(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: '已提交，等待审批', icon: 'success' });
        setTimeout(() => wx.navigateBack({ fail() {} }), 1200);
      })
      .catch((error) => {
        this.setData({ submitting: false });
        wx.showToast({ title: error.message, icon: 'none' });
      });
  },
});
