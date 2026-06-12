import 'bootstrap'
import 'bootstrap/dist/css/bootstrap.css'
import React from 'react'
import * as ReactDOM from 'react-dom/client'

import { FSSMainPage } from './fss-main-page'
import { LoginPage } from './login-page'
import { ConfigPage } from './config-page'
import { AssetListPage } from './asset-list-page'

const App: React.FC = () => {
  const [path, setPath] = React.useState(window.location.pathname)

  React.useEffect(() => {
    const onLocationChange = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onLocationChange)
    return () => window.removeEventListener('popstate', onLocationChange)
  }, [])

  const normalizedPath = path.replace(/\/+$/, '') || '/'

  if (normalizedPath === '/login') return <LoginPage />
  if (normalizedPath === '/config') return <ConfigPage />
  if (normalizedPath === '/assets') return <AssetListPage />

  return <FSSMainPage />
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)
