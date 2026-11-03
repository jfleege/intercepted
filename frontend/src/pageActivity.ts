import { createContext, useContext } from 'react';
export const PageActivity = createContext(true);
export const usePageActive = () => useContext(PageActivity);
