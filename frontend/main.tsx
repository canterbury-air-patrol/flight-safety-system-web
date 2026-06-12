import 'bootstrap'
import 'bootstrap/dist/css/bootstrap.css'
import React from 'react'
import * as ReactDOM from 'react-dom/client'

import { FSSMainPage } from './fss-main-page'
import { LoginPage } from './login-page'
import { ConfigPage } from './config-page'
import { AssetListPage } from './asset-list-page'

const App: React.FC = () => {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/login') return <LoginPage />
  if (path === '/config') return <ConfigPage />
  if (path === '/assets') return <AssetListPage />

  return <FSSMainPage />
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)
