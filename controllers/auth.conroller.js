import db from "../config/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

// ─── Constants ───────────────────────────────────────────────────────────────
const ACCESS_TOKEN_EXPIRY = "5h";
const REFRESH_TOKEN_EXPIRY = "1d";
const SALT_ROUNDS = 12;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validates that a string is non-empty after trimming.
 */
const isNonEmpty = (value) =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Signs a JWT access token.
 */
const signAccessToken = (username) =>
  jwt.sign({ user_name: username }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });

/**
 * Signs a JWT refresh token.
 */
const signRefreshToken = (username) =>
  jwt.sign({ user_name: username }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });

/**
 * Shared cookie options for the refresh token cookie.
 */
const refreshCookieOptions = {
  httpOnly: true,
  maxAge: 24 * 60 * 60 * 1000, // 1 day in ms
  sameSite: "None",
  secure: true,
};

// ─── Database Queries ────────────────────────────────────────────────────────

/**
 * Fetches a user record by username.
 * Returns the first matching row or null.
 */
const getUserByUsername = async (username) => {
  const [rows] = await db.query(
    `SELECT
       user_id, user_username, user_password, user_groupid,
       user_departmentid, user_site, user_firstname, user_lastname,
       user_resetstatus
     FROM user_records
     WHERE user_username = ?
     LIMIT 1`,
    [username],
  );
  return rows[0] ?? null;
};

/**
 * Fetches a user record by their stored refresh token.
 * Returns the first matching row or null.
 */
const getUserByRefreshToken = async (token) => {
  const [rows] = await db.query(
    `SELECT
       user_id, user_username, user_groupid, user_departmentid,
       user_site, user_firstname, user_lastname, user_resetstatus
     FROM user_records
     WHERE user_refresh_token = ?
     LIMIT 1`,
    [token],
  );
  return rows[0] ?? null;
};

/**
 * Saves a new refresh token against a user ID.
 */
const saveRefreshToken = async (userId, token) => {
  await db.query(
    `UPDATE user_records SET user_refresh_token = ? WHERE user_id = ?`,
    [token, userId],
  );
};

/**
 * Clears the refresh token for a user ID.
 */
const clearRefreshToken = async (userId) => {
  await db.query(
    `UPDATE user_records SET user_refresh_token = NULL WHERE user_id = ?`,
    [userId],
  );
};

/**
 * Returns the password expiration date for a user.
 */
const getUserExpDate = async (userId) => {
  const [rows] = await db.query(
    `SELECT user_expiration_date FROM user_records WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return rows[0]?.user_expiration_date ?? null;
};

/**
 * Updates a user's hashed password.
 */
const updatePassword = async (userId, hashedPassword) => {
  await db.query(
    `UPDATE user_records
     SET user_password = ?, user_resetstatus = 0
     WHERE user_id = ?`,
    [hashedPassword, userId],
  );
};

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /auth/login
 * Authenticates a user and returns an access token + sets a refresh cookie.
 */
export const loginFunction = async (req, res) => {
  try {
    const { user_name: username, user_password: password } = req.body;

    // --- Input validation ---
    if (!isNonEmpty(username) || !isNonEmpty(password)) {
      return res.status(400).json({
        errorStatus: true,
        message: "Username and password are required.",
      });
    }

    // Use a generic message to avoid username enumeration
    const INVALID_CREDENTIALS_MSG = "Invalid username or password.";

    // --- Lookup user ---
    const user = await getUserByUsername(username.trim());
    if (!user) {
      return res.status(401).json({
        errorStatus: true,
        message: INVALID_CREDENTIALS_MSG,
      });
    }

    // --- Password check ---
    const isMatch = await bcrypt.compare(password, user.user_password);
    if (!isMatch) {
      return res.status(401).json({
        errorStatus: true,
        message: INVALID_CREDENTIALS_MSG,
      });
    }

    // --- Issue tokens ---
    const accessToken = signAccessToken(user.user_username);
    const refreshToken = signRefreshToken(user.user_username);

    await saveRefreshToken(user.user_id, refreshToken);

    res.cookie("jwt", refreshToken, refreshCookieOptions);

    return res.status(200).json({
      errorStatus: false,
      userId: user.user_id,
      groupId: user.user_groupid,
      departmentId: user.user_departmentid,
      userSite: user.user_site,
      userFullname: `${user.user_firstname} ${user.user_lastname}`.trim(),
      resetStatus: user.user_resetstatus,
      accessToken,
    });
  } catch (err) {
    console.error("[loginFunction]", err);
    return res.status(500).json({
      errorStatus: true,
      message: "Unable to process your request. Contact your administrator.",
    });
  }
};

/**
 * GET /auth/refresh
 * Issues a new access token using a valid refresh cookie.
 */
export const refreshFunction = async (req, res) => {
  try {
    const refreshToken = req.cookies?.jwt;
    if (!refreshToken) {
      return res.sendStatus(401); // Unauthorized — no cookie present
    }

    // Verify the token belongs to an existing user
    const user = await getUserByRefreshToken(refreshToken);
    if (!user) {
      // Token exists in cookie but not in DB — possible token reuse attack
      return res.sendStatus(403);
    }

    // Cryptographically verify the token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch {
      return res.sendStatus(403); // Expired or tampered token
    }

    // Ensure the token's subject matches the DB record
    if (user.user_username !== decoded.user_name) {
      return res.sendStatus(403);
    }

    const accessToken = signAccessToken(decoded.user_name);

    return res.status(200).json({
      userId: user.user_id,
      groupId: user.user_groupid,
      departmentId: user.user_departmentid,
      userSite: user.user_site,
      userFullname: `${user.user_firstname} ${user.user_lastname}`.trim(),
      resetStatus: user.user_resetstatus,
      accessToken,
    });
  } catch (err) {
    console.error("[refreshFunction]", err);
    return res.status(500).json({
      errorStatus: true,
      message: "Unable to process your request. Contact your administrator.",
    });
  }
};

/**
 * POST /auth/logout
 * Clears the refresh token from the DB and removes the cookie.
 */
export const logoutFunction = async (req, res) => {
  try {
    const refreshToken = req.cookies?.jwt;

    // Always clear the cookie regardless of token validity
    res.clearCookie("jwt", {
      httpOnly: true,
      sameSite: "None",
      secure: true,
    });

    if (!refreshToken) {
      return res.sendStatus(204); // Nothing to do
    }

    const user = await getUserByRefreshToken(refreshToken);
    if (user) {
      await clearRefreshToken(user.user_id);
    }

    return res.sendStatus(204);
  } catch (err) {
    console.error("[logoutFunction]", err);
    return res.status(500).json({
      errorStatus: true,
      message: "Unable to process your request. Contact your administrator.",
    });
  }
};

/**
 * PATCH /auth/reset-password/:id
 * Resets a user's password if their reset link has not expired.
 */
export const resetPassword = async (req, res) => {
  try {
    const userId = req.params.id;
    const { user_password: newPassword } = req.body;

    // --- Input validation ---
    if (!isNonEmpty(userId) || !isNonEmpty(newPassword)) {
      return res.status(400).json({
        errorStatus: true,
        message: "User ID and new password are required.",
      });
    }

    // Enforce minimum password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        errorStatus: true,
        message: "Password must be at least 8 characters.",
      });
    }

    // --- Check expiration ---
    const expirationDate = await getUserExpDate(userId);
    if (!expirationDate) {
      return res.status(404).json({
        errorStatus: true,
        message: "User not found.",
      });
    }

    const isExpired = new Date(expirationDate) < new Date();
    if (isExpired) {
      return res.status(410).json({
        errorStatus: true,
        message: "Password reset link has expired.",
      });
    }

    // --- Hash and save ---
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await updatePassword(userId, hashedPassword);

    return res.status(200).json({
      errorStatus: false,
      message: "Password has been changed successfully.",
    });
  } catch (err) {
    console.error("[resetPassword]", err);
    return res.status(500).json({
      errorStatus: true,
      message: "Unable to process your request. Contact your administrator.",
    });
  }
};
