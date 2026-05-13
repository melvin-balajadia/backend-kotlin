import db from "../config/db.js";
import bcrypt from "bcrypt";
import AppError from "../utils/appError.js";

const SALT_ROUNDS = 12;

const isNonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

const USER_SELECT =
  "u.user_id, u.user_username, u.user_firstname, u.user_lastname, " +
  "u.user_groupid, g.group_name, u.user_departmentid, u.user_site, " +
  "u.user_status, u.user_resetstatus, u.created_at, u.updated_at";

// ─── GET /users ───────────────────────────────────────────────────────────────
export const getUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? 1, 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit ?? 20, 10)),
    );
    const status = req.query.status ?? "active";
    const offset = (page - 1) * limit;

    const validStatuses = ["active", "inactive", "all"];
    if (!validStatuses.includes(status)) {
      return next(
        new AppError(
          "Invalid status filter. Use active, inactive, or all.",
          400,
        ),
      );
    }

    const whereClause = status === "all" ? "" : "WHERE u.user_status = ?";
    const params = status === "all" ? [limit, offset] : [status, limit, offset];
    const countParams = status === "all" ? [] : [status];

    const [rows] = await db.query(
      "SELECT " +
        USER_SELECT +
        " " +
        "FROM user_records u " +
        "LEFT JOIN `groups` g ON g.group_id = u.user_groupid " +
        whereClause +
        " " +
        "ORDER BY u.created_at DESC " +
        "LIMIT ? OFFSET ?",
      params,
    );

    const [[{ total }]] = await db.query(
      "SELECT COUNT(*) AS total FROM user_records u " + whereClause,
      countParams,
    );

    return res.status(200).json({
      errorStatus: false,
      data: rows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /users/:id ───────────────────────────────────────────────────────────
export const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      "SELECT " +
        USER_SELECT +
        " " +
        "FROM user_records u " +
        "LEFT JOIN `groups` g ON g.group_id = u.user_groupid " +
        "WHERE u.user_id = ? LIMIT 1",
      [id],
    );

    if (!rows[0]) {
      return next(new AppError("User not found.", 404));
    }

    return res.status(200).json({ errorStatus: false, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

// ─── POST /users ──────────────────────────────────────────────────────────────
export const createUser = async (req, res, next) => {
  try {
    const {
      user_username,
      user_password,
      user_firstname,
      user_lastname,
      user_groupid,
      user_departmentid,
      user_site,
    } = req.body;

    if (!isNonEmpty(user_username)) {
      return next(new AppError("Username is required.", 400));
    }
    if (!isNonEmpty(user_password) || user_password.length < 8) {
      return next(new AppError("Password must be at least 8 characters.", 400));
    }
    if (!isNonEmpty(user_firstname) || !isNonEmpty(user_lastname)) {
      return next(new AppError("First name and last name are required.", 400));
    }
    if (!user_groupid) {
      return next(new AppError("A group must be assigned to the user.", 400));
    }

    const [[existing]] = await db.query(
      "SELECT user_id FROM user_records WHERE user_username = ? LIMIT 1",
      [user_username.trim()],
    );
    if (existing) {
      return next(new AppError("Username already exists.", 409));
    }

    const [[group]] = await db.query(
      "SELECT group_id FROM `groups` WHERE group_id = ? AND group_is_active = 1 LIMIT 1",
      [user_groupid],
    );
    if (!group) {
      return next(
        new AppError("The specified group does not exist or is inactive.", 400),
      );
    }

    const hashed = await bcrypt.hash(user_password, SALT_ROUNDS);

    const [result] = await db.query(
      "INSERT INTO user_records " +
        "(user_username, user_password, user_firstname, user_lastname, " +
        "user_groupid, user_departmentid, user_site, user_resetstatus, user_status) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active')",
      [
        user_username.trim(),
        hashed,
        user_firstname.trim(),
        user_lastname.trim(),
        user_groupid,
        user_departmentid ?? null,
        user_site ?? null,
      ],
    );

    return res.status(201).json({
      errorStatus: false,
      message: "User created successfully.",
      data: { user_id: result.insertId, user_username: user_username.trim() },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /users/:id ─────────────────────────────────────────────────────────
export const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      user_firstname,
      user_lastname,
      user_groupid,
      user_departmentid,
      user_site,
    } = req.body;

    const fields = [];
    const values = [];

    if (isNonEmpty(user_firstname)) {
      fields.push("user_firstname = ?");
      values.push(user_firstname.trim());
    }
    if (isNonEmpty(user_lastname)) {
      fields.push("user_lastname = ?");
      values.push(user_lastname.trim());
    }
    if (user_groupid != null) {
      fields.push("user_groupid = ?");
      values.push(user_groupid);
    }
    if (user_departmentid != null) {
      fields.push("user_departmentid = ?");
      values.push(user_departmentid);
    }
    if (user_site != null) {
      fields.push("user_site = ?");
      values.push(user_site);
    }

    if (fields.length === 0) {
      return next(new AppError("No valid fields provided for update.", 400));
    }

    if (user_groupid != null) {
      const [[group]] = await db.query(
        "SELECT group_id FROM `groups` WHERE group_id = ? AND group_is_active = 1 LIMIT 1",
        [user_groupid],
      );
      if (!group) {
        return next(
          new AppError(
            "The specified group does not exist or is inactive.",
            400,
          ),
        );
      }
    }

    values.push(id);
    const [result] = await db.query(
      "UPDATE user_records SET " + fields.join(", ") + " WHERE user_id = ?",
      values,
    );

    if (result.affectedRows === 0) {
      return next(new AppError("User not found.", 404));
    }

    return res
      .status(200)
      .json({ errorStatus: false, message: "User updated successfully." });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /users/:id/status ──────────────────────────────────────────────────
export const setUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["active", "inactive"].includes(status)) {
      return next(new AppError("Status must be 'active' or 'inactive'.", 400));
    }

    if (parseInt(id, 10) === req.user.user_id && status === "inactive") {
      return next(new AppError("You cannot deactivate your own account.", 400));
    }

    const [result] = await db.query(
      "UPDATE user_records SET user_status = ? WHERE user_id = ?",
      [status, id],
    );

    if (result.affectedRows === 0) {
      return next(new AppError("User not found.", 404));
    }

    return res.status(200).json({
      errorStatus: false,
      message: `User ${status === "active" ? "activated" : "deactivated"} successfully.`,
    });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /users/:id/force-reset ─────────────────────────────────────────────
export const forceResetPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!isNonEmpty(new_password) || new_password.length < 8) {
      return next(
        new AppError("New password must be at least 8 characters.", 400),
      );
    }

    const hashed = await bcrypt.hash(new_password, SALT_ROUNDS);

    const [result] = await db.query(
      "UPDATE user_records SET user_password = ?, user_resetstatus = 1 WHERE user_id = ?",
      [hashed, id],
    );

    if (result.affectedRows === 0) {
      return next(new AppError("User not found.", 404));
    }

    return res.status(200).json({
      errorStatus: false,
      message: "Temporary password set. User must change it on next login.",
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /paginated-users ─────────────────────────────────────────────────────
export const getPaginatedUsers = async (req, res, next) => {
  try {
    const { paginate } = await import("../utils/paginate.js");

    const result = await paginate({
      query: req.query,
      table:
        "user_records u LEFT JOIN `groups` g ON g.group_id = u.user_groupid",
      db,
      searchColumns: [
        "u.user_username",
        "u.user_firstname",
        "u.user_lastname",
        "g.group_name",
        "u.user_site",
      ],
      allowedSorts: [
        "u.user_id",
        "u.user_username",
        "u.user_firstname",
        "u.user_lastname",
        "u.user_status",
        "u.created_at",
      ],
      defaultSort: "u.user_id",
      selectClause:
        "u.user_id, u.user_username, u.user_firstname, u.user_lastname, " +
        "u.user_groupid, g.group_name, u.user_departmentid, u.user_site, " +
        "u.user_status, u.user_resetstatus, u.created_at, u.updated_at",
      filters: (query, conditions, values) => {
        const { status, user_site } = query;
        if (status && status !== "all") {
          conditions.push("u.user_status = ?");
          values.push(status);
        }
        if (user_site) {
          conditions.push("u.user_site LIKE ?");
          values.push(`%${user_site}%`);
        }
      },
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};
