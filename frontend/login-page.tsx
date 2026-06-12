import React, { useState, useEffect } from 'react'
import { Container, Card, Form, Button, Alert } from 'react-bootstrap'

const getCookie = (name: string) =>
  document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? ''

export const LoginPage: React.FC = () => {
  const [csrfToken, setCsrfToken] = useState('')
  const searchParams = new URLSearchParams(window.location.search)
  const hasError = searchParams.get('error') === '1'

  useEffect(() => {
    setCsrfToken(decodeURIComponent(getCookie('csrftoken')))
  }, [])

  return (
    <Container className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
      <Card style={{ width: '400px' }}>
        <Card.Body>
          <Card.Title className="text-center mb-4">Flight Safety System - Login</Card.Title>
          {hasError && <Alert variant="danger">Invalid username or password.</Alert>}
          <Form method="POST" action="/login/">
            <input type="hidden" name="csrfmiddlewaretoken" value={csrfToken} />
            <Form.Group className="mb-3">
              <Form.Label>Username</Form.Label>
              <Form.Control type="text" name="username" required />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Password</Form.Label>
              <Form.Control type="password" name="password" required />
            </Form.Group>
            <Button variant="primary" type="submit" className="w-100">
              Login
            </Button>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  )
}
