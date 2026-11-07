const dateUtil = require('../../utils/date');
const api = require('../../utils/api');
const notice = require('../../utils/notice');

const TABS = [
  { key: 'day', label: '当天' },
  { key: 'week', label: '当周' },
  { key: 'month', label: '当月' },
];

function nameOrPlaceholder(value) {
  return value || '未配置';
}

Page({
  data: {
    tabs: TABS,
    activeTab: 'day',
    loading: true,
    error: '',
    day: null,
    week: { rangeLabel: '', days: [] },
    month: { title: '', summary: '', days: [] },
    noticeCount: 0,
    noticeText: '',
    noticeIsAdmin: false,
  },

  onLoad() {
    this.cache = {};
    this.todayKey = dateUtil.todayKey();
    this.loadActive();
  },

  onShow() {
    const today = dateUtil.todayKey();
    const app = getApp();
    const dirty = app && app.globalData && app.globalData.rosterDirty;

    if (dirty) {
      if (app.globalData) app.globalData.rosterDirty = false;
      this.cache = {};
      this.todayKey = today;
      this.loadActive();
    } else if (this.todayKey && this.todayKey !== today) {
      this.todayKey = today;
      this.cache = {};
      this.loadActive();
    }

    this.refreshNotice();
  },

  refreshNotice() {
    notice.refreshNotice().then((res) => {
      const summary = res.summary || {};
      const count = res.admin ? summary.pendingTotal || 0 : summary.pendingAsTarget || 0;
      this.setData({
        noticeCount: count,
        noticeIsAdmin: res.admin,
        noticeText: res.admin
          ? count + ' 条换班申请待处理'
          : '有 ' + count + ' 条换班请求找你',
      });
    });
  },

  onNoticeTap() {
    if (this.data.noticeIsAdmin) {
      wx.navigateTo({ url: '/pages/admin/admin' });
      return;
    }
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  onTabChange(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) return;

    // 再点当前页签：强制刷新
    if (key === this.data.activeTab) {
      if (this.currentRangeKey) delete this.cache[this.currentRangeKey];
      this.loadActive();
      return;
    }

    this.setData({ activeTab: key, error: '' });
    this.loadActive();
  },

  onRetry() {
    this.cache = {};
    this.loadActive();
  },

  loadActive() {
    const tab = this.data.activeTab;
    if (tab === 'day') return this.loadDay();
    if (tab === 'week') return this.loadWeek();
    return this.loadMonth();
  },

  fetchRange(startDate, endDate) {
    const key = startDate + '_' + endDate;
    this.currentRangeKey = key;
    if (this.cache[key]) return Promise.resolve(this.cache[key]);
    return api.fetchRoster(startDate, endDate).then((roster) => {
      this.cache[key] = roster;
      return roster;
    });
  },

  loadDay() {
    const today = dateUtil.todayKey();
    this.setData({ loading: true, error: '' });
    return this.fetchRange(today, today)
      .then((roster) => {
        const day = roster.days && roster.days[0];
        this.setData({
          loading: false,
          day: day
            ? {
                dateLabel: dateUtil.monthDay(day.date),
                weekday: day.weekday,
                dayTypeLabel: day.dayTypeLabel,
                groupName: day.groupName,
                backupLeader: nameOrPlaceholder(day.backupLeader),
                backupGroupName: day.substituted
                  ? day.substitution.fromGroupNo + '组代班'
                  : '',
                dutyLeader: nameOrPlaceholder(day.dutyLeader),
                staffText: nameOrPlaceholder(day.staffText),
                note: day.note || '',
              }
            : null,
        });
      })
      .catch((error) => this.setData({ loading: false, error: error.message }));
  },

  loadWeek() {
    const today = dateUtil.todayKey();
    const range = dateUtil.weekRange(today);
    this.setData({ loading: true, error: '' });
    return this.fetchRange(range.startDate, range.endDate)
      .then((roster) => {
        const days = (roster.days || []).map((day) => ({
          date: day.date,
          dateLabel: dateUtil.monthDayShort(day.date),
          weekday: day.weekday,
          dayTypeLabel: day.dayTypeLabel,
          backupLeader: nameOrPlaceholder(day.backupLeader),
          dutyLeader: nameOrPlaceholder(day.dutyLeader),
          staffText: nameOrPlaceholder(day.staffText),
          substituted: Boolean(day.substituted),
          isToday: day.date === today,
        }));
        this.setData({
          loading: false,
          week: {
            rangeLabel:
              dateUtil.monthDay(range.startDate) + ' - ' + dateUtil.monthDay(range.endDate),
            days,
          },
        });
      })
      .catch((error) => this.setData({ loading: false, error: error.message }));
  },

  loadMonth() {
    const today = dateUtil.todayKey();
    const range = dateUtil.monthRange(today);
    this.setData({ loading: true, error: '' });
    return this.fetchRange(range.startDate, range.endDate)
      .then((roster) => {
        const counts = { workday: 0, weekend: 0, holiday: 0 };
        const days = (roster.days || []).map((day) => {
          counts[day.dayType] = (counts[day.dayType] || 0) + 1;
          return {
            date: day.date,
            dateLabel: dateUtil.monthDayShort(day.date),
            weekday: day.weekday,
            dayTypeLabel: day.dayTypeLabel,
            shiftName: day.shiftName || '—',
            shiftTime: day.shiftTime || '—',
            backupLeader: nameOrPlaceholder(day.backupLeader),
            dutyLeader: nameOrPlaceholder(day.dutyLeader),
            staffText: nameOrPlaceholder(day.staffText),
            note: day.note || '',
            isToday: day.date === today,
          };
        });
        this.setData({
          loading: false,
          month: {
            title: range.year + '年' + range.month + '月',
            summary:
              '工作日 ' +
              counts.workday +
              ' 天 · 周末 ' +
              counts.weekend +
              ' 天 · 节假日 ' +
              counts.holiday +
              ' 天',
            days,
          },
        });
      })
      .catch((error) => this.setData({ loading: false, error: error.message }));
  },
});
