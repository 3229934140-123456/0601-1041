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
  chain?: ChainNode[];
  invitationId?: mongoose.Types.ObjectId;
}

export interface ChainNode {
  spaceId: mongoose.Types.ObjectId;
  spaceName: string;
  spaceType: string;
  isPublic: boolean;
  hasRoleAccess: boolean;
  hasUserAccess: boolean;
  hasUserGrant: boolean;
  result: 'allowed' | 'denied' | 'inherited_allowed';
  reason: string;
  checkedRules: {
    rule: string;
    passed: boolean;
    detail: string;
  }[];
}

export interface AccessCheckOptions {
  checkInheritance?: boolean;
  invitationId?: string;
  adminViewMode?: boolean;
}

export interface SimulateAccessResult {
  simulatedUser: {
    id: mongoose.Types.ObjectId;
    name: string;
    email: string;
    role: string;
  };
  targetSpace: {
    id: mongoose.Types.ObjectId;
    name: string;
    type: string;
  };
  finalResult: AccessCheckResult;
  detailedChain: ChainNode[];
  spacePath: {
    id: mongoose.Types.ObjectId;
    name: string;
    type: string;
  }[];
  accessibleAreas: {
    spaceId: mongoose.Types.ObjectId;
    spaceName: string;
    spaceType: string;
    access: boolean;
  }[];
  suggestions: string[];
}

export interface InvitationScopeResult {
  invitation: {
    id: mongoose.Types.ObjectId;
    code: string;
    type: string;
    status: string;
    expiresAt: Date;
    inviteeEmail?: string;
    inviteeName?: string;
    createdByName?: string;
  };
  directlyAllowedSpaces: {
    id: mongoose.Types.ObjectId;
    name: string;
    type: string;
    level: number;
  }[];
  inheritedAllowedSpaces: {
    id: mongoose.Types.ObjectId;
    name: string;
    type: string;
    level: number;
    inheritedFrom: mongoose.Types.ObjectId;
    inheritedFromName: string;
  }[];
  allAllowedSpaceIds: mongoose.Types.ObjectId[];
  totalAllowed: number;
  scopeDescription: string;
}

class SpaceAccessService {
  static async checkAccess(
    user: IUser & { _id: mongoose.Types.ObjectId },
    space: ISpace,
    options: AccessCheckOptions = {}
  ): Promise<AccessCheckResult> {
    const { checkInheritance = true, invitationId, adminViewMode = false } = options;

    const spacesToCheck: ISpace[] = [];
    if (checkInheritance && space.spacePath && space.spacePath.length > 0) {
      const parentSpaces = await Space.find({
        _id: { $in: space.spacePath },
      }).sort({ level: 1 });
      spacesToCheck.push(...parentSpaces, space);
    } else {
      spacesToCheck.push(space);
    }

    let invitationInfo: {
      allowedSpaceIds: string[];
      isGuest: boolean;
      isInvitationValid: boolean;
      invitationId?: mongoose.Types.ObjectId;
    } | null = null;

    if (invitationId && user.role === 'guest') {
      const Invitation = (await import('../models/Invitation')).default;
      const invitation = await Invitation.findById(invitationId);
      if (invitation &&
        (invitation.status === 'pending' || invitation.status === 'accepted') &&
        invitation.type === 'guest' &&
        new Date() < invitation.expiresAt) {
        invitationInfo = {
          allowedSpaceIds: (invitation.allowedSpaces || []).map((id) => id.toString()),
          isGuest: true,
          isInvitationValid: true,
          invitationId: invitation._id,
        };
      } else {
        invitationInfo = {
          allowedSpaceIds: [],
          isGuest: true,
          isInvitationValid: false,
        };
      }
    }

    if (adminViewMode) {
      if (user.role === 'admin') {
        return {
          access: true,
          reason: '管理员后台管理视角',
          level: 'admin',
          matchedSpaceId: space._id,
          matchedSpaceName: space.name,
          chain: this._buildChain(spacesToCheck, user, invitationInfo || undefined),
        };
      }
      if (user.role === 'moderator') {
        return {
          access: true,
          reason: '协调员管理视角',
          level: 'moderator',
          matchedSpaceId: space._id,
          matchedSpaceName: space.name,
          chain: this._buildChain(spacesToCheck, user, invitationInfo || undefined),
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
          chain: this._buildChain(spacesToCheck, user, invitationInfo || undefined),
        };
      }
      if (user.role === 'moderator') {
        return {
          access: true,
          reason: '协调员权限',
          level: 'moderator',
          matchedSpaceId: space._id,
          matchedSpaceName: space.name,
          chain: this._buildChain(spacesToCheck, user, invitationInfo || undefined),
        };
      }
    }

    if (invitationInfo) {
      const targetInAllowed = invitationInfo.allowedSpaceIds.includes(space._id.toString());
      let parentInAllowed = false;
      if (checkInheritance && space.spacePath) {
        parentInAllowed = space.spacePath.some(
          (pid) => invitationInfo!.allowedSpaceIds.includes(pid.toString())
        );
      }

      if (targetInAllowed || parentInAllowed) {
        return {
          access: true,
          reason: '访客邀请授权访问',
          level: 'invitation',
          matchedSpaceId: space._id,
          matchedSpaceName: space.name,
          invitationId: invitationInfo.invitationId,
          chain: this._buildChain(spacesToCheck, user, invitationInfo),
        };
      }
    }

    for (const s of spacesToCheck) {
      const result = this._checkSingleSpace(user, s);
      if (result.access) {
        return {
          ...result,
          matchedSpaceId: s._id,
          matchedSpaceName: s.name,
          chain: this._buildChain(spacesToCheck, user, invitationInfo || undefined),
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
      chain: this._buildChain(spacesToCheck, user, invitationInfo || undefined),
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
    user: IUser & { _id: mongoose.Types.ObjectId },
    invitation?: {
      allowedSpaceIds: string[];
      isGuest: boolean;
      isInvitationValid: boolean;
    }
  ): ChainNode[] {
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

      const hasInvitationAccess = !!(
        invitation?.isInvitationValid &&
        invitation?.isGuest &&
        invitation?.allowedSpaceIds.includes(s._id.toString())
      );

      const checkedRules: ChainNode['checkedRules'] = [];

      checkedRules.push({
        rule: '空间公开',
        passed: s.isPublic,
        detail: s.isPublic ? '空间设为公开，所有人可访问' : '空间为私有，需要授权',
      });

      checkedRules.push({
        rule: '角色白名单',
        passed: hasRoleAccess,
        detail: hasRoleAccess
          ? `角色「${user.role}」在空间角色白名单中`
          : s.allowedRoles?.length
            ? `空间角色白名单为 ${s.allowedRoles.join('、')}，不包含您的角色「${user.role}」`
            : '未设置角色白名单',
      });

      checkedRules.push({
        rule: '用户白名单',
        passed: hasUserAccess,
        detail: hasUserAccess
          ? '您的用户ID在空间用户白名单中'
          : s.allowedUsers?.length
            ? '空间用户白名单不包含您的用户ID'
            : '未设置用户白名单',
      });

      checkedRules.push({
        rule: '管理员单独授权',
        passed: hasUserGrant,
        detail: hasUserGrant
          ? '管理员为您单独授权了此空间'
          : user.allowedSpaces?.length
            ? '您的单独授权列表中无此空间'
            : '未设置单独授权',
      });

      if (invitation) {
        checkedRules.push({
          rule: '访客邀请',
          passed: hasInvitationAccess,
          detail: hasInvitationAccess
            ? '访客邀请码包含此空间的访问权限'
            : invitation.isInvitationValid
              ? '访客邀请码的允许范围不包含此空间'
              : '访客邀请码无效或已过期',
        });
      }

      const singleResult = this._checkSingleSpace(user, s);
      let result: ChainNode['result'] = 'denied';
      let reason = '无匹配的放行规则';

      if (user.role === 'admin') {
        result = 'allowed';
        reason = '管理员特权，自动放行';
      } else if (user.role === 'moderator') {
        result = 'allowed';
        reason = '协调员权限，自动放行';
      } else if (hasInvitationAccess) {
        result = 'allowed';
        reason = '访客邀请授权，放行';
      } else if (singleResult.access) {
        result = 'allowed';
        reason = singleResult.reason;
      }

      return {
        spaceId: s._id,
        spaceName: s.name,
        spaceType: s.type,
        isPublic: s.isPublic,
        hasRoleAccess,
        hasUserAccess,
        hasUserGrant,
        result,
        reason,
        checkedRules,
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
        parts.push(`  · ${node.spaceName} (${node.spaceType}): ${flagStr} - ${node.reason}`);
      }
    }

    return parts.join('');
  }

  static async simulateAccess(
    targetUserId: mongoose.Types.ObjectId,
    spaceId: mongoose.Types.ObjectId,
    options: { invitationId?: string; checkInheritance?: boolean } = {}
  ): Promise<SimulateAccessResult> {
    const User = (await import('../models/User')).default;

    const user = await User.findById(targetUserId);
    if (!user) {
      throw new Error('模拟用户不存在');
    }

    const space = await Space.findById(spaceId);
    if (!space) {
      throw new Error('目标空间不存在');
    }

    const finalResult = await this.checkAccess(user as any, space, options);

    const spacesToCheck: ISpace[] = [];
    if (options.checkInheritance !== false && space.spacePath && space.spacePath.length > 0) {
      const parentSpaces = await Space.find({
        _id: { $in: space.spacePath },
      }).sort({ level: 1 });
      spacesToCheck.push(...parentSpaces, space);
    } else {
      spacesToCheck.push(space);
    }

    const spacePath = spacesToCheck.map((s) => ({
      id: s._id,
      name: s.name,
      type: s.type,
    }));

    const accessibleAreas = [];
    for (const s of spacesToCheck) {
      const r = await this.checkAccess(user as any, s, { checkInheritance: false });
      accessibleAreas.push({
        spaceId: s._id,
        spaceName: s.name,
        spaceType: s.type,
        access: r.access,
      });
    }

    const suggestions: string[] = [];
    if (!finalResult.access) {
      if (user.role === 'guest' && !options.invitationId) {
        suggestions.push('访客需要邀请码才能访问，请提供有效的访客邀请码');
      }
      if (finalResult.chain) {
        const deniedNodes = finalResult.chain.filter((n) => n.result === 'denied');
        for (const node of deniedNodes) {
          if (!node.isPublic) {
            suggestions.push(`空间「${node.spaceName}」为私有空间，可考虑：1) 设为公开 2) 将用户角色添加到角色白名单 3) 将用户添加到用户白名单 4) 为用户单独授权`);
          }
          if (!node.hasRoleAccess) {
            suggestions.push(`用户角色「${user.role}」不在空间「${node.spaceName}」的角色白名单中`);
          }
          if (!node.hasUserAccess && !node.hasUserGrant) {
            suggestions.push(`用户不在空间「${node.spaceName}」的用户白名单中，也没有单独授权`);
          }
        }
      }
    }

    return {
      simulatedUser: {
        id: user._id,
        name: user.displayName,
        email: user.email,
        role: user.role,
      },
      targetSpace: {
        id: space._id,
        name: space.name,
        type: space.type,
      },
      finalResult,
      detailedChain: finalResult.chain || [],
      spacePath,
      accessibleAreas,
      suggestions: [...new Set(suggestions)].slice(0, 5),
    };
  }

  static async getInvitationScope(
    invitationId: mongoose.Types.ObjectId
  ): Promise<InvitationScopeResult> {
    const Invitation = (await import('../models/Invitation')).default;
    const User = (await import('../models/User')).default;

    const invitation = await Invitation.findById(invitationId);
    if (!invitation) {
      throw new Error('邀请码不存在');
    }

    let creator: any = null;
    if (invitation.inviterId) {
      creator = await User.findById(invitation.inviterId).select('displayName');
    }

    const directlyAllowedSpaceIds = invitation.allowedSpaces || [];
    const directlyAllowedSpaces = await Space.find({
      _id: { $in: directlyAllowedSpaceIds },
      isActive: true,
    }).select('name type level').sort({ level: 1, sortOrder: 1 });

    const inheritedAllowedSpaces: InvitationScopeResult['inheritedAllowedSpaces'] = [];
    const allAllowedSpaceIds = new Set<string>();

    for (const allowedSpace of directlyAllowedSpaces) {
      allAllowedSpaceIds.add(allowedSpace._id.toString());

      const childSpaces = await Space.find({
        spacePath: allowedSpace._id,
        isActive: true,
      }).select('name type level parentId');

      for (const child of childSpaces) {
        if (!allAllowedSpaceIds.has(child._id.toString())) {
          allAllowedSpaceIds.add(child._id.toString());
          inheritedAllowedSpaces.push({
            id: child._id,
            name: child.name,
            type: child.type,
            level: child.level,
            inheritedFrom: allowedSpace._id,
            inheritedFromName: allowedSpace.name,
          });
        }
      }
    }

    const directlyAllowedResult: InvitationScopeResult['directlyAllowedSpaces'] =
      directlyAllowedSpaces.map((s) => ({
        id: s._id,
        name: s.name,
        type: s.type,
        level: s.level,
      }));

    const totalAllowed = allAllowedSpaceIds.size;
    const floorCount = [...allAllowedSpaceIds].filter((id) => {
      const s = [...directlyAllowedSpaces, ...inheritedAllowedSpaces.map((i) => ({ ...i }))].find(
        (sp) => sp.id.toString() === id
      );
      return s?.type === 'floor';
    }).length;
    const roomCount = [...allAllowedSpaceIds].filter((id) => {
      const s = [...directlyAllowedSpaces, ...inheritedAllowedSpaces.map((i) => ({ ...i }))].find(
        (sp) => sp.id.toString() === id
      );
      return s?.type === 'room';
    }).length;
    const areaCount = [...allAllowedSpaceIds].filter((id) => {
      const s = [...directlyAllowedSpaces, ...inheritedAllowedSpaces.map((i) => ({ ...i }))].find(
        (sp) => sp.id.toString() === id
      );
      return s?.type === 'area';
    }).length;

    const scopeParts: string[] = [];
    if (floorCount > 0) scopeParts.push(`${floorCount} 个楼层`);
    if (roomCount > 0) scopeParts.push(`${roomCount} 个房间`);
    if (areaCount > 0) scopeParts.push(`${areaCount} 个区域`);
    const scopeDescription = `共可访问 ${totalAllowed} 个空间：${scopeParts.join('、')}。${
      inheritedAllowedSpaces.length > 0
        ? `其中直接授权 ${directlyAllowedResult.length} 个，继承授权 ${inheritedAllowedSpaces.length} 个。`
        : ''
    }`;

    return {
      invitation: {
        id: invitation._id,
        code: invitation.code,
        type: invitation.type,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        inviteeEmail: invitation.inviteeEmail,
        inviteeName: invitation.inviteeName,
        createdByName: creator?.displayName,
      },
      directlyAllowedSpaces: directlyAllowedResult,
      inheritedAllowedSpaces,
      allAllowedSpaceIds: Array.from(allAllowedSpaceIds).map(
        (id) => new mongoose.Types.ObjectId(id)
      ),
      totalAllowed,
      scopeDescription,
    };
  }
}

export default SpaceAccessService;
