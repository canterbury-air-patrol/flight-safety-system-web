import React, { useState, useEffect } from 'react'
import { Container, Table, Spinner, Alert } from 'react-bootstrap'

interface AssetConfigData {
  name: string
  pk: number
  smm_name: string | null
  smm_login: string | null
}

export const AssetListPage: React.FC = () => {
  const [assets, setAssets] = useState<AssetConfigData[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/assets.json')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((data) => setAssets(data.assets))
      .catch((e) => setError(e.message))
  }, [])

  if (error) {
    return (
      <Container className="mt-4">
        <Alert variant="danger">Error loading assets: {error}</Alert>
      </Container>
    )
  }

  if (!assets) {
    return (
      <Container className="mt-4 text-center">
        <Spinner animation="border" />
      </Container>
    )
  }

  return (
    <Container className="mt-4">
      <div className="h3 mb-4">Assets</div>
      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Name</th>
            <th>Search Management Map</th>
            <th>SMM - User</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.pk}>
              <td>{a.name}</td>
              <td>{a.smm_name || 'N/A'}</td>
              <td>{a.smm_login || 'N/A'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Container>
  )
}
