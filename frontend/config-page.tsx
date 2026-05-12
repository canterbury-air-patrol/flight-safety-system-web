import React, { useState, useEffect } from 'react'
import { Container, Table, Spinner, Alert } from 'react-bootstrap'

interface FSSServerConfig {
  name: string
  address: string
  client_port: number
  config_port: number
  https: boolean
  url: string
}

interface SMMServerConfig {
  name: string
  address: string
  port: number
  https: boolean
  url: string
}

interface AssetConfigData {
  name: string
  pk: number
  smm_name: string | null
  smm_login: string | null
}

interface ConfigData {
  fss_servers: FSSServerConfig[]
  smm_servers: SMMServerConfig[]
  assets: AssetConfigData[]
}

export const ConfigPage: React.FC = () => {
  const [data, setData] = useState<ConfigData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/config/status.json')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  if (error) {
    return (
      <Container className="mt-4">
        <Alert variant="danger">Error loading configuration: {error}</Alert>
      </Container>
    )
  }

  if (!data) {
    return (
      <Container className="mt-4 text-center">
        <Spinner animation="border" />
      </Container>
    )
  }

  return (
    <Container className="mt-4">
      <h3>Flight Safety System Servers</h3>
      <Table striped bordered hover className="mb-4">
        <thead>
          <tr>
            <th>Name</th>
            <th>Address</th>
            <th>Client Port</th>
            <th>Config Port</th>
            <th>HTTPS</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          {data.fss_servers.map((s) => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td>{s.address}</td>
              <td>{s.client_port}</td>
              <td>{s.config_port}</td>
              <td>{String(s.https)}</td>
              <td>
                <a href={s.url}>Go</a>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <h3>Search Management Map Servers</h3>
      <Table striped bordered hover className="mb-4">
        <thead>
          <tr>
            <th>Name</th>
            <th>Address</th>
            <th>Port</th>
            <th>HTTPS</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          {data.smm_servers.map((s) => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td>{s.address}</td>
              <td>{s.port}</td>
              <td>{String(s.https)}</td>
              <td>
                <a href={s.url}>Go</a>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <h3>Assets</h3>
      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Name</th>
            <th>Search Management Map</th>
            <th>SMM - User</th>
          </tr>
        </thead>
        <tbody>
          {data.assets.map((a) => (
            <tr key={a.pk}>
              <td>{a.name}</td>
              {a.smm_name ? (
                <>
                  <td>{a.smm_name}</td>
                  <td>{a.smm_login}</td>
                </>
              ) : (
                <td colSpan={2} className="text-muted text-center">
                  No config
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </Container>
  )
}
