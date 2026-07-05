export function requireBearer(req, res, next) {
  const expected = process.env.QWEN_PROXY_TOKEN;
  if (!expected) {
    return res.status(500).json({
      code: 5000,
      msg: 'QWEN_PROXY_TOKEN 未配置',
    });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== expected) {
    return res.status(401).json({
      code: 4101,
      msg: '鉴权失败：Authorization Bearer token 无效',
    });
  }
  return next();
}
