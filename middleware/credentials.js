import allowedOrigins from "../config/allowedOrigin.js";

const credentials = (req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Credentials", "true"); // ← string, not boolean
    res.header("Access-Control-Allow-Origin", origin); // ← explicitly echo the origin
    res.header("Vary", "Origin"); // ← tells proxies/CDNs response varies by origin
  }

  next();
};

export default credentials;
