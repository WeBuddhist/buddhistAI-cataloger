import type { User, UserRowUpdate } from '@/api/user';
import AvatarWrapper from '@/components/AvatarWrapper';

interface UserRowProps {
  readonly user: User;
  readonly onUpdate: (userId: string, userData: UserRowUpdate) => void;
  readonly onDelete: (userId: string) => void;
}

const USER_ROLES = ['user', 'annotator', 'reviewer', 'admin'];
const PERMISSIONS = ['outliner', 'cataloger', 'dedup', 'outline_fix', 'author_identification'];

function UserRow({ user, onUpdate, onDelete }: UserRowProps) {
  const handleRoleChange = (newRole: string) => {
    onUpdate(user.id, { role: newRole });
  };

  const handlePermissionChange = (permission: string, checked: boolean) => {
    const currentPermissions = user.permissions || [];
    const newPermissions = checked
      ? [...currentPermissions, permission]
      : currentPermissions.filter(p => p !== permission);
    onUpdate(user.id, { permissions: newPermissions });
  };

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {user.picture && (
            <AvatarWrapper src={user.picture} alt={user.name || user.email} />
          )}
          <div>
            <div className="text-sm font-medium text-gray-900">
              {user.name || 'No name'}
            </div>
            <div className="text-sm text-gray-500">{user.email}</div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <select
          value={user.role || 'user'}
          onChange={(e) => handleRoleChange(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {role.charAt(0).toUpperCase() + role.slice(1)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex flex-wrap gap-2">
          {PERMISSIONS.map((permission) => {
            const isChecked = user.permissions?.includes(permission) || false;
            return (
              <label
                key={permission}
                className="flex items-center text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => handlePermissionChange(permission, e.target.checked)}
                  className="mr-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-gray-700 capitalize">{permission}</span>
              </label>
            );
          })}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {new Date(user.created_at).toLocaleDateString()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
        <button
          onClick={() => onDelete(user.id)}
          className="text-red-600 hover:text-red-900"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

export default UserRow;
