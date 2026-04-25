import React, { createContext, useContext } from 'react';

interface StorefrontContextType {
  basePath: string;
  cartCount: number;
  shopName?: string;
  supportLink?: string;
  botUsername?: string | null;
  botAvatarUrl?: string | null;
  slug?: string;
}

const StorefrontContext = createContext<StorefrontContextType>({ basePath: '', cartCount: 0 });

const sanitizeSupportLink = (raw?: string): string | undefined => {
  if (!raw) return undefined;
  const candidate = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:') return undefined;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 't.me' || hostname === 'telegram.me') return parsed.toString();
    return undefined;
  } catch {
    return undefined;
  }
};

export const StorefrontProvider: React.FC<{
  basePath: string;
  cartCount: number;
  shopName?: string;
  supportLink?: string;
  botUsername?: string | null;
  botAvatarUrl?: string | null;
  slug?: string;
  children: React.ReactNode;
}> = ({ basePath, cartCount, shopName, supportLink, botUsername, botAvatarUrl, slug, children }) => {
  const normalizedSupportLink = sanitizeSupportLink(supportLink);

  return (
    <StorefrontContext.Provider value={{ basePath, cartCount, shopName, supportLink: normalizedSupportLink, botUsername, botAvatarUrl, slug }}>
      {children}
    </StorefrontContext.Provider>
  );
};

export const useStorefront = () => useContext(StorefrontContext);

/** Build a full path within the current storefront */
export const useStorefrontPath = () => {
  const { basePath } = useStorefront();
  return (path: string) => {
    if (!path || path === '/') return basePath || '/';
    return `${basePath}${path.startsWith('/') ? path : `/${path}`}`;
  };
};