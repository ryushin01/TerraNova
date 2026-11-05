import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

export const ac = createAccessControl(defaultStatements);

/** Permissions over accounts. Device control is decided separately by canControl. */
export const roles = {
  admin: ac.newRole(adminAc.statements),
  operator: ac.newRole({ user: [], session: [] }),
  viewer: ac.newRole({ user: [], session: [] }),
};
