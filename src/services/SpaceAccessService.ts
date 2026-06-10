import mongoose from 'mongoose';
import Space, { ISpace } from '../models/Space';
import { IUser } from '../models/User';

export interface AccessCheckResult {
  access: boolean;
  reason: string;
  level: 'admin' | 'moderator' | 'space_public' | 'space_role' | 'space_user' | 'user_granted' | 'parent_inherited' | 'invitation' | 'denied';
  matchedSpaceId?: mongoose.Types.ObjectId;
  matchedSpaceName?: string;
  matchedRule?: string;
  chain?: {
    spaceId: mongoose.Types.ObjectId;
    spaceName: string;
    spaceType: string;
    isPublic: boolean;
    hasRoleAccess: boolean;
    hasUserAccess: boolean;
    hasUserGrant: boolean;
  }[];
  invitationId?: mongoose.Types.ObjectId;
}

export interface AccessCheckOptions {
  checkInheritance?: boolean;
  invitationId?: string;
  adminViewMode?: boolean;
}

class SpaceAccessService {
  static async checkAccess(
    user: IUser & { _id: mongoose.Types.ObjectId },
    space: ISpace,
    options: AccessCheckOptions = {}
  ): Promise<AccessCheckResult> {
    const { checkInheritance = true, invitationId, adminViewMode = false } = options;
    const chain: AccessCheckResult['chain'] = [];

    const spacesToCheck: ISpace[] = [];
    if (checkInheritance && space.spacePath && space.spacePath.length > 0) {
      const parentSpaces = await Space.find({
        _id: { $in: space.spacePath },
      }).sort({ level: 1 });
      spacesToCheck.push(...parentSpaces, space);
    } else {
      spacesToCheck.push(space);
    }

    if (adminViewMode) {
      if (user.role === 'admin') {
        return {
          access: true,
          reason: '管理员后台管理视角',
          level: 'admin',
          matchedSpaceId: space._id,
          matchedSpaceName: space.name,
          chain: this._buildChain(spacesToCheck, user),
        };
      }
      if (user.role === 'moderator') {
        return {
          access: true,
          reason: '协调员管理视角',
          level: 'moderator',
          matchedSpaceId: space._id,
          matchedSpaceName: space.name,
          chain: this._buildChain(spacesToCheck, user),
        };
      }
    } else {
      if (user.role === 'admin') {
        return {
          access: true,
          reason: '管理员特权',
          level: 'admin',
          matchedSpaceId: space._id,
          matchedSpaceName: space.name,
          chain: this._buildChain(spacesToCheck, user),
        };
      }
      if (user.role === 'moderator') {
        return {
          access: true,
          reason: '协调员权限',
          level: 'moderator',
          matchedSpaceId: space._id,
          matchedSpaceName: space.name,
          chain: this._buildChain(spacesToCheck, user),
        };
      }
    }

    if (invitationId && user.role === 'guest') {
      const Invitation = (await import('../models/Invitation')).default;
      const invitation = await Invitation.findById(invitationId);
      if (invitation && (invitation.status === 'pending' || invitation.status === 'accepted') && invitation.type === 'guest' && new Date() < invitation.expiresAt) {
        const allowedSpaceIds = (invitation.allowedSpaces || []).map((id) => id.toString());
        const targetInAllowed = allowedSpaceIds.includes(space._id.toString());

        let parentInAllowed = false;
        if (checkInheritance && space.spacePath) {
          parentInAllowed = space.spacePath.some(
            (pid) => allowedSpaceIds.includes(pid.toString())
          );
        }

        if (targetInAllowed || parentInAllowed) {
          return {
            access: true,
            reason: '访客邀请授权访问',
            level: 'invitation',
            matchedSpaceId: space._id,
            matchedSpaceName: space.name,
            invitationId: invitation._id,
            chain: this._buildChain(spacesToCheck, user),
          };
        }
      }
    }

    for (const s of spacesToCheck) {
      const result = this._checkSingleSpace(user, s);
      if (result.access) {
        return {
          ...result,
          matchedSpaceId: s._id,
          matchedSpaceName: s.name,
          chain: this._buildChain(spacesToCheck, user),
          level: s._id.toString() === space._id.toString() ? result.level : 'parent_inherited',
          reason: s._id.toString() === space._id.toString()
            ? result.reason
            : `继承自父空间「${s.name}」: ${result.reason}`,
        };
      }
    }

    return {
      access: false,
      reason: '空间为私有且您不在任何一级的访问白名单中',
      level: 'denied',
      matchedSpaceId: space._id,
      matchedSpaceName: space.name,
      chain: this._buildChain(spacesToCheck, user),
    };
  }

  private static _checkSingleSpace(
    user: IUser & { _id: mongoose.Types.ObjectId },
    space: ISpace
  ): { access: boolean; reason: string; level: AccessCheckResult['level'] } {
    if (space.isPublic) {
      return { access: true, reason: '空间公开', level: 'space_public' };
    }

    if (space.allowedRoles && space.allowedRoles.length > 0) {
      if (space.allowedRoles.includes(user.role)) {
        return {
          access: true,
          reason: `角色白名单包含您的角色: ${user.role}`,
          level: 'space_role',
        };
      }
    }

    if (space.allowedUsers && space.allowedUsers.length > 0) {
      if (space.allowedUsers.some((u) => u.toString() === user._id.toString())) {
        return { access: true, reason: '您在空间的用户白名单中', level: 'space_user' };
      }
    }

    if (user.allowedSpaces && user.allowedSpaces.length > 0) {
      if (user.allowedSpaces.some((s) => s.toString() === space._id.toString())) {
        return { access: true, reason: '管理员为您单独授权了此空间', level: 'user_granted' };
      }
    }

    return { access: false, reason: '无访问权限', level: 'denied' };
  }

  private static _buildChain(
    spaces: ISpace[],
    user: IUser & { _id: mongoose.Types.ObjectId }
  ): AccessCheckResult['chain'] {
    return spaces.map((s) => {
      const hasRoleAccess = !!(
        s.allowedRoles &&
        s.allowedRoles.length > 0 &&
        s.allowedRoles.includes(user.role)
      );
      const hasUserAccess = !!(
        s.allowedUsers &&
        s.allowedUsers.length > 0 &&
        s.allowedUsers.some((u) => u.toString() === user._id.toString())
      );
      const hasUserGrant = !!(
        user.allowedSpaces &&
        user.allowedSpaces.length > 0 &&
        user.allowedSpaces.some((sp) => sp.toString() === s._id.toString())
      );

      return {
        spaceId: s._id,
        spaceName: s.name,
        spaceType: s.type,
        isPublic: s.isPublic,
        hasRoleAccess,
        hasUserAccess,
        hasUserGrant,
      };
    });
  }

  static async canBulkAccess(
    user: IUser & { _id: mongoose.Types.ObjectId },
    spaceIds: mongoose.Types.ObjectId[],
    options: AccessCheckOptions = {}
  ): Promise<Record<string, AccessCheckResult>> {
    const spaces = await Space.find({ _id: { $in: spaceIds } });
    const results: Record<string, AccessCheckResult> = {};

    for (const space of spaces) {
      results[space._id.toString()] = await this.checkAccess(user, space, options);
    }

    return results;
  }

  static async getAccessibleSpaces(
    user: IUser & { _id: mongoose.Types.ObjectId },
    options: {
      type?: string;
      parentId?: string;
      checkInheritance?: boolean;
    } = {}
  ): Promise<ISpace[]> {
    const { type, parentId, checkInheritance = true } = options;

    if (user.role === 'admin' || user.role === 'moderator') {
      const query: any = { isActive: true };
      if (type) query.type = type;
      if (parentId) query.parentId = new mongoose.Types.ObjectId(parentId);
      return Space.find(query).sort({ sortOrder: 1, level: 1 });
    }

    const query: any = { isActive: true };
    if (type) query.type = type;
    if (parentId) query.parentId = new mongoose.Types.ObjectId(parentId);

    const allSpaces = await Space.find(query).sort({ sortOrder: 1, level: 1 });
    const accessible: ISpace[] = [];

    for (const space of allSpaces) {
      const result = await this.checkAccess(user, space, { checkInheritance });
      if (result.access) {
        accessible.push(space);
      }
    }

    return accessible;
  }

  static explainDenial(result: AccessCheckResult): string {
    if (result.access) return '';

    const parts: string[] = [];
    parts.push(`访问被拒: ${result.reason}`);

    if (result.chain && result.chain.length > 0) {
      parts.push('\n权限检查链路（从根到目标）:');
      for (const node of result.chain) {
        const flags = [];
        if (node.isPublic) flags.push('公开');
        if (node.hasRoleAccess) flags.push('角色白名单通过');
        if (node.hasUserAccess) flags.push('用户白名单通过');
        if (node.hasUserGrant) flags.push('用户授权通过');

        const flagStr = flags.length > 0 ? flags.join('、') : '无匹配规则';
        parts.push(`  · ${node.spaceName} (${node.spaceType}): ${flagStr}`);
      }
    }

    return parts.join('');
  }
}

export default SpaceAccessService;
