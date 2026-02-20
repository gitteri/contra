interface UserAvatarProps {
  firstName: string;
  lastName: string;
  color: string;
}

export function UserAvatar({ firstName, lastName, color }: UserAvatarProps) {
  const initials = `${firstName[0]}${lastName[0]}`;

  return (
    <div className="user-avatar" style={{ backgroundColor: color }}>
      {initials}
    </div>
  );
}
