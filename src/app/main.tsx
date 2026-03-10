import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, ColorSchemeScript } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { theme } from './theme';
import App from './App';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ColorSchemeScript defaultColorScheme="dark" />
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <ModalsProvider>
        <Notifications position="top-right" limit={5} />
        <App />
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>,
);
