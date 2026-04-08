import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { SessionProvider } from '@/contexts/SessionContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { DataStreamProvider } from '@/components/data-stream-provider';
import { Toaster } from 'sonner';
import RootLayout from '@/layouts/RootLayout';
import ChatLayout from '@/layouts/ChatLayout';
import NewChatPage from '@/pages/NewChatPage';
import ChatPage from '@/pages/ChatPage';

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <SessionProvider>
        <AppConfigProvider>
          <DataStreamProvider>
            <Toaster position="top-center" />
            <Routes>
              <Route path="/" element={<RootLayout />}>
                <Route element={<ChatLayout />}>
                  <Route index element={<NewChatPage />} />
                  <Route path="chat/:id" element={<ChatPage />} />
                </Route>
              </Route>
            </Routes>
          </DataStreamProvider>
        </AppConfigProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

export default App;
