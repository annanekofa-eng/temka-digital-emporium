import { createContext, useContext, ReactNode } from 'react';

interface StorefrontValue {
  basePath: string;
  shopName: string;
  cartCount: number;
  supportLink: string;
}

const StorefrontContext = createContext<StorefrontValue>({
  basePath: '',
  shopName: 'TeleStore',
  cartCount: 0,
  supportLink: 'https://t.me/TeleStoreHelp',
});

interface ProviderProps extends Partial<StorefrontValue> {
  children: ReactNode;
}

export const StorefrontProvider = ({ children, basePath = '', shopName = 'TeleStore', cartCount = 0, supportLink = 'https://t.me/TeleStoreHelp' }: ProviderProps) => (
  <StorefrontContext.Provider value={{ basePath, shopName, cartCount, supportLink }}>
    {children}
  </StorefrontContext.Provider>
);

export const useStorefront = () => useContext(StorefrontContext);

export const useStorefrontPath = () => {
  const { basePath } = useStorefront();
  return (path: string) => {
    const clean = path.startsWith('/') ? path : `/${path}`;
    return basePath ? `${basePath}${clean}` : clean;
  };
};
