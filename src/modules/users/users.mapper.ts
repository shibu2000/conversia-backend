import { iso, isoRequired } from "../../core/serialize";

export interface UserRowShape {
  id: string;
  companyId: string | null;
  name: string;
  email: string;
  avatarUrl: string | null;
  platformRole: string;
  roleId: string | null;
  roleName: string | null;
  status: string;
  title: string | null;
  phone: string | null;
  timezone: string;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Shape the frontend's `User` type expects. */
export function toUser(
  row: UserRowShape,
  extras: { assignedLeadCount?: number; assignedTicketCount?: number; teamIds?: string[] } = {},
) {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl ?? undefined,
    platformRole: row.platformRole,
    roleId: row.roleId,
    roleName: row.roleName ?? (row.platformRole === "super_admin" ? "Super Admin" : "Platform Support"),
    status: row.status,
    title: row.title ?? undefined,
    phone: row.phone ?? undefined,
    timezone: row.timezone,
    lastActiveAt: iso(row.lastActiveAt),
    assignedLeadCount: Number(extras.assignedLeadCount ?? 0),
    assignedTicketCount: Number(extras.assignedTicketCount ?? 0),
    teamIds: extras.teamIds ?? [],
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toRole(row: {
  id: string;
  companyId: string | null;
  slug: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}, userCount: number) {
  return {
    id: row.id,
    companyId: row.companyId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    permissions: row.permissions,
    userCount,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}
