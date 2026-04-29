import jwt from "jsonwebtoken";

/**
 * Middleware: Verifies the Bearer access token from the Authorization header.
 * Attaches decoded user info to req.user on success.
 */
const verifyJWT = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;

    // Reject if header is missing or malformed
    if (!authHeader?.startsWith("Bearer ")) {
      return res.sendStatus(401); // Unauthorized
    }

    const token = authHeader.split(" ")[1];

    // Guard: reject empty token (e.g. "Bearer " with no value)
    if (!token) {
      return res.sendStatus(401);
    }

    // Verify signature and expiry synchronously
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // Attach only what downstream handlers need — avoid exposing the full payload
    req.user = {
      user_name: decoded.user_name,
    };

    next();
  } catch (err) {
    // TokenExpiredError, JsonWebTokenError, NotBeforeError all land here
    return res.sendStatus(403); // Forbidden — invalid or expired token
  }
};

export default verifyJWT;
