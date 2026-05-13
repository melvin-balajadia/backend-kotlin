import express from "express";
import catchAsync from "../utils/catchAsync.js";
import verifyJWT from "../middleware/verifyJWT.js";
import checkPermission from "../middleware/checkPermission.js";

import {
  getGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  getPermissions,
  setGroupPermissions,
  patchGroupPermissions,
  getPaginatedGroups,
  getGroupUsers,
  reassignGroupUsers,
} from "../controllers/group.controller.js";

const router = express.Router();

router.use(verifyJWT);

// ─── Permissions (catalogue — read-only for most) ─────────────────────────────
router.get(
  "/permissions",
  checkPermission("group:view"),
  catchAsync(getPermissions),
);

// ─── Groups ───────────────────────────────────────────────────────────────────
router.get("/groups", checkPermission("group:view"), catchAsync(getGroups));

router.get(
  "/groups/:id",
  checkPermission("group:view"),
  catchAsync(getGroupById),
);

router.post(
  "/groups",
  checkPermission("group:create"),
  catchAsync(createGroup),
);

router.patch(
  "/groups/:id",
  checkPermission("group:edit"),
  catchAsync(updateGroup),
);

router.delete(
  "/groups/:id",
  checkPermission("group:delete"),
  catchAsync(deleteGroup),
);

// ─── Group ↔ Permission assignment ───────────────────────────────────────────
// PUT  — full replacement (admin sets exact permission set)
router.put(
  "/groups/:id/permissions",
  checkPermission("group:assign_permission"),
  catchAsync(setGroupPermissions),
);

// PATCH — incremental add/remove
router.patch(
  "/groups/:id/permissions",
  checkPermission("group:assign_permission"),
  catchAsync(patchGroupPermissions),
);

router.get(
  "/paginated-groups",
  checkPermission("group:view"),
  catchAsync(getPaginatedGroups),
);

// ─── Group user management ────────────────────────────────────────────────────
router.get(
  "/groups/:id/users",
  checkPermission("group:view"),
  catchAsync(getGroupUsers),
);

router.post(
  "/groups/:id/reassign",
  checkPermission("user:edit"),
  catchAsync(reassignGroupUsers),
);

export default router;
