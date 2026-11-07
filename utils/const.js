module.exports = {
  ADMIN_TOKEN_KEY: 'rosterAdminToken',
  USER_NAME_KEY: 'rosterUserName',
  API_BASE_KEY: 'rosterApiBase',

  // 微信云托管：填了环境 ID 与服务器名后，小程序改用 wx.cloud.callContainer 调用，
  // 不需要 request 合法域名，也不受云托管默认域名「不可用于正式环境」的限制。
  // 环境 ID 形如 prod-1g2h3j4k，服务名在云托管控制台「服务管理」里查看。
  CLOUD_ENV: 'prod-d7g469zwia27ad762',
  CLOUD_SERVICE: 'roster-server',
};
