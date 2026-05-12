import { useState, type ReactNode } from 'react'
import { Header } from './Header'
import { Footer } from './Footer'
import { Sidebar } from './Sidebar'
import { ToastContainer } from '../common'
import { MigrationProvider } from '../../context/MigrationContext'

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <MigrationProvider>
      <div className="min-h-screen flex flex-col">
        <Header
          onMenuClick={() => setSidebarOpen(true)}
          showMenuButton
        />

        <div className="flex-1 flex">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

          <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
            <div className="max-w-6xl mx-auto">
              {children}
            </div>
          </main>
        </div>

        <Footer />
        <ToastContainer />
      </div>
    </MigrationProvider>
  )
}
