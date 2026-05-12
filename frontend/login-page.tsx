import React, { useState, useEffect } from 'react'
import { Container, Card, Form, Button } from 'react-bootstrap'

export const LoginPage: React.FC = () => {
  const [csrfToken, setCsrfToken] = useState('')

  useEffect(() => {
    // Read CSRF token from cookie
    const name = 'csrftoken='
    const decodedCookie = decodeURIComponent(document.cookie)
    const ca = decodedCookie.split(';')
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i]
      while (c.charAt(0) === ' ') {
        c = c.substring(1)
      }
      if (c.indexOf(name) === 0) {
        setCsrfToken(c.substring(name.length, c.length))
        break
      }
    }
  }, [])

  return (
    <Container className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
      <Card style={{ width: '400px' }}>
        <Card.Body>
          <Card.Title className="text-center mb-4">Flight Safety System - Login</Card.Title>
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
