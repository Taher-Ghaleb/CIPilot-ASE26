import { Link } from 'react-router-dom'
import { Home, ArrowLeft } from 'lucide-react'
import { Button, Card } from '../components/common'

export function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card variant="glass" padding="lg" className="text-center max-w-md">
        <div className="text-6xl mb-4">404</div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Page Not Found</h1>
        <p className="text-[var(--text-secondary)] mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button variant="primary" leftIcon={<Home className="w-4 h-4" />}>
              Go Home
            </Button>
          </Link>
          <Button variant="secondary" onClick={() => window.history.back()} leftIcon={<ArrowLeft className="w-4 h-4" />}>
            Go Back
          </Button>
        </div>
      </Card>
    </div>
  )
}
