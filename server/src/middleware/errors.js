export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      message: `接口不存在：${req.method} ${req.originalUrl}`,
      code: 'NOT_FOUND',
    },
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = error.status ?? 500;
  if (status >= 500) {
    console.error('[roster] 未处理异常:', error);
  }
  res.status(status).json({
    error: {
      message: error.message ?? '服务器内部错误',
      code: error.name ?? 'INTERNAL_ERROR',
      details: error.details ?? null,
    },
  });
}
