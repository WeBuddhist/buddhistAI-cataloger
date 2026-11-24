import { useAuth0 } from '@auth0/auth0-react';
import { Link, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import LanguageSelector from '@/components/formComponent/LanguageSelector';
import { useUI } from '@/context/UIContext';
import { ChevronDown, Settings } from 'lucide-react';
import { useUser } from '@/hooks/useUser';
import { Button } from '@/components/ui/button';
import AvatarWrapper from '@/components/AvatarWrapper';
import { isDedupAdmin } from '@/features/dedup/utils';
import { hasOutlineFixAccess, isOutlineFixAdmin } from '@/features/outline-fix/utils';
import { useFixerMe } from '@/features/outline-fix/hooks';
import { hasAuthorIdAccess, isAuthorIdAdmin } from '@/features/author-identification/access/utils';
import { useAuthorIdMe } from '@/features/author-identification/access/hooks';


function Navigation() {
  const { logout, isLoading,user,isAuthenticated,loginWithRedirect } = useAuth0();
  const { brandIconUrl, primaryColor } = useUI();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const {user:userFromDb} = useUser();
  // The Outline Fixer's own role; asked only of users who have access to it.
  const outlineFixMe = useFixerMe(hasOutlineFixAccess(userFromDb));
  // Author Identification's own role, likewise.
  const authorIdMe = useAuthorIdMe(hasAuthorIdAccess(userFromDb));
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: Number.parseInt(result[1], 16),
          g: Number.parseInt(result[2], 16),
          b: Number.parseInt(result[3], 16),
        }
      : null;
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  // On an admin page, the menu opens with the Admin section already expanded.
  const onAdminPage = /^\/(outliner|dedup|outline-fix|author-identification)-admin(\/|$)/.test(location.pathname);
  useEffect(() => {
    if (isMenuOpen) setAdminOpen(onAdminPage);
  }, [isMenuOpen, onAdminPage]);

  const handleLogout = () => {
    logout({
      logoutParams: {
        returnTo: globalThis.location.origin + '/login',
      },
    });
    setIsMenuOpen(false);
  };
  if (isLoading) return null;

  const isActive = (path: string) => location.pathname === path;
  const isAdminOrReviewer = userFromDb?.role === 'admin' || userFromDb?.role === 'reviewer';
  // Admin areas this user can open: the Outliner's (its admins and reviewers) and the
  // Deduplicator's (its own admins, set apart). With both, "Admin" expands; with one, it
  // links straight there.
  const adminAreas = [
    ...(isAdminOrReviewer ? [{ to: '/outliner-admin', label: 'Outliner' }] : []),
    ...(isDedupAdmin(userFromDb) ? [{ to: '/dedup-admin', label: 'Deduplicator' }] : []),
    ...(isOutlineFixAdmin(outlineFixMe.data) ? [{ to: '/outline-fix-admin', label: 'Outline Fixer' }] : []),
    ...(isAuthorIdAdmin(authorIdMe.data) ? [{ to: '/author-identification-admin', label: 'Author Identification' }] : []),
  ];
  const primaryRgb = hexToRgb(primaryColor);
  const getActiveStyle = (isActiveLink: boolean) => {
    if (!isActiveLink || !primaryRgb) return undefined;
    return {
      backgroundColor: `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.1)`,
      color: primaryColor,
    };
  };

  const handleLogin = () => {
    loginWithRedirect({
      appState: {
        returnTo: window.location.pathname || '/',
      },
    });
  };
  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center">
                <img src={brandIconUrl} alt="logo" className="w-full h-full object-cover" />
              </div>
            </Link>

            <div className="hidden md:flex items-center gap-6">
              <Link
                to="/"
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive('/') ? '' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
                style={getActiveStyle(isActive('/'))}
              >
                Home
              </Link>
              {/* Hidden for now: Texts and Persons are not shown in the Cataloger.
              <Link
                to="/texts"
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.pathname.startsWith('/texts')
                    ? ''
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
                style={getActiveStyle(location.pathname.startsWith('/texts'))}
              >
                Texts
              </Link>
              <Link
                to="/persons"
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.pathname.startsWith('/persons')
                    ? ''
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
                style={getActiveStyle(location.pathname.startsWith('/persons'))}
              >
                Persons
              </Link>
              */}
              <Link
                to="/outliner"
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.pathname.startsWith('/outliner')
                    ? ''
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
                style={getActiveStyle(location.pathname.startsWith('/outliner'))}
              >
                Outliner
              </Link>
              <Link
                to="/dedup"
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.pathname.startsWith('/dedup')
                    ? ''
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
                style={getActiveStyle(location.pathname.startsWith('/dedup'))}
              >
                Deduplicator
              </Link>
              {hasOutlineFixAccess(userFromDb) && (
                <Link
                  to="/outline-fix"
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    location.pathname.startsWith('/outline-fix')
                      ? ''
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                  style={getActiveStyle(location.pathname.startsWith('/outline-fix'))}
                >
                  Outline Fixer
                </Link>
              )}
              {hasAuthorIdAccess(userFromDb) && (
                <Link
                  to="/author-identification"
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    location.pathname.startsWith('/author-identification')
                      ? ''
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                  style={getActiveStyle(location.pathname.startsWith('/author-identification'))}
                >
                  Author Identification
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <LanguageSelector />
             {!isAuthenticated && <Button 
              onClick={handleLogin} 
              className='cursor-pointer'
              variant="ghost">Login</Button>}
            {isAuthenticated && user && <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
                  {user.picture ? (
                    <AvatarWrapper src={user.picture} alt={user?.name || user?.email || ''} />
                  ) : (
                    <span className="text-sm font-medium text-gray-600">
                      {user.name?.[0]?.toUpperCase() || 'U'}
                    </span>
                  )}
                </div>
                <span className="hidden md:block text-sm font-medium text-gray-700">
                  {user.name || user.email}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-500 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {isMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <p className="text-sm font-medium text-gray-900">{user.name || 'User'}</p>
                    <p className="text-xs text-gray-500 truncate">{user.email}</p>
                  </div>
                  <Link
                    to="/profile"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    Profile
                  </Link>
                  {adminAreas.length === 1 && (
                    <Link
                      to={adminAreas[0].to}
                      onClick={() => setIsMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      Admin
                    </Link>
                  )}
                  {adminAreas.length > 1 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setAdminOpen((o) => !o)}
                        aria-expanded={adminOpen}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                      >
                        <Settings className="w-4 h-4" />
                        Admin
                        <ChevronDown className={`ml-auto w-4 h-4 text-gray-400 transition-transform ${adminOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {adminOpen &&
                        adminAreas.map((area) => {
                          const current =
                            location.pathname === area.to || location.pathname.startsWith(`${area.to}/`);
                          return (
                            <Link
                              key={area.to}
                              to={area.to}
                              aria-current={current ? 'page' : undefined}
                              onClick={() => {
                                setIsMenuOpen(false);
                                setAdminOpen(false);
                              }}
                              className={`flex items-center py-2 pl-11 pr-4 text-sm transition-colors ${
                                current ? 'font-medium' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                              }`}
                              style={getActiveStyle(current)}
                            >
                              {area.label}
                            </Link>
                          );
                        })}
                    </div>
                  )}
                  <Link
                    to="/settings"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    Settings
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                      />
                    </svg>
                    Sign Out
                  </button>
                </div>
              )}
            </div>}
          </div>
        </div>
      </div>
    </nav>
  );
}

export default Navigation;
