import 'bootstrap'
import 'bootstrap/dist/css/bootstrap.css'
import React from 'react'
import * as ReactDOM from 'react-dom/client'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'

import { FSSMainPage } from './fss-main-page'
import { LoginPage } from './login-page'
import { ConfigPage } from './config-page'

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <Router>
    <Routes>
      <Route path="/" element={<FSSMainPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/" element={<LoginPage />} />
      <Route path="/config" element={<ConfigPage />} />
      <Route path="/config/" element={<ConfigPage />} />
    </Routes>
  </Router>
)
