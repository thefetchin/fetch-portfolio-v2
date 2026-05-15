import { useState, useEffect, useRef } from 'react'
import emailjs from '@emailjs/browser'
import './Contact.css'

const Contact = () => {
  const contactRef = useRef(null)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    message: ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible')
          }
        })
      },
      { threshold: 0.1 }
    )

    if (contactRef.current) {
      observer.observe(contactRef.current)
    }

    return () => {
      if (contactRef.current) {
        observer.unobserve(contactRef.current)
      }
    }
  }, [])

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitStatus(null)

    try {
      // Using EmailJS to send emails
      // You need to set up EmailJS account at https://www.emailjs.com/
      // Get your Service ID, Template ID, and Public Key from EmailJS dashboard
      
      const serviceID = import.meta.env.VITE_EMAILJS_SERVICE_ID || 'YOUR_SERVICE_ID'
      const templateID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID || 'YOUR_TEMPLATE_ID'
      const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || 'YOUR_PUBLIC_KEY'

      // Check if EmailJS is properly configured
      if (serviceID !== 'YOUR_SERVICE_ID' && templateID !== 'YOUR_TEMPLATE_ID' && publicKey !== 'YOUR_PUBLIC_KEY') {
        await emailjs.send(
          serviceID,
          templateID,
          {
            from_name: formData.name,
            from_email: formData.email,
            user_name: formData.name,
            user_email: formData.email,
            name: formData.name,
            email: formData.email,
            company: formData.company || 'Not provided',
            message: formData.message,
            to_email: 'thefetch.in@gmail.com',
            reply_to: formData.email
          },
          publicKey
        )
        
        setIsSubmitting(false)
        setSubmitStatus('success')
        setFormData({ name: '', email: '', company: '', message: '' })
      } else {
        // Fallback: Use mailto link if EmailJS is not configured
        const subject = encodeURIComponent(`Contact from ${formData.name}${formData.company ? ` - ${formData.company}` : ''}`)
        const body = encodeURIComponent(`Name: ${formData.name}\nEmail: ${formData.email}\nCompany: ${formData.company || 'Not provided'}\n\nMessage:\n${formData.message}`)
        window.location.href = `mailto:thefetch.in@gmail.com?subject=${subject}&body=${body}`
        
        setIsSubmitting(false)
        setSubmitStatus('success')
        setFormData({ name: '', email: '', company: '', message: '' })
      }
      
      setTimeout(() => {
        setSubmitStatus(null)
      }, 5000)
    } catch (error) {
      console.error('Error sending email:', error)
      setIsSubmitting(false)
      setSubmitStatus('error')
      
      setTimeout(() => {
        setSubmitStatus(null)
      }, 5000)
    }
  }

  return (
    <section id="contact" ref={contactRef} className="contact">
      <div className="contact-container">
        <div className="contact-header">
          <h2 className="section-title">
            Get In <span className="accent-text">Touch</span>
          </h2>
          <p className="section-description">
            Ready to transform your space with smart retail solutions? Let's talk.
          </p>
        </div>
        <div className="contact-content">
          <div className="contact-info">
            <div className="info-card">
              <div className="info-icon">📧</div>
              <h3>Email</h3>
              <a href="mailto:thefetch.in@gmail.com" className="info-link">thefetch.in@gmail.com</a>
            </div>
            <div className="info-card">
              <div className="info-icon">📞</div>
              <h3>Phone</h3>
              <a href="tel:+919019526185" className="info-link">+91 9019526185</a>
            </div>
            <div className="info-card">
              <div className="info-icon">📍</div>
              <h3>Address</h3>
              <p className="info-address">Lucia Mansion, Kalpane Kulshekara,<br />Mangalore - 575005</p>
            </div>
          </div>
          <form className="contact-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="name">Name</label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                placeholder="Your name"
              />
            </div>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                placeholder="your.email@example.com"
              />
            </div>
            <div className="form-group">
              <label htmlFor="company">Company</label>
              <input
                type="text"
                id="company"
                name="company"
                value={formData.company}
                onChange={handleChange}
                placeholder="Your company (optional)"
              />
            </div>
            <div className="form-group">
              <label htmlFor="message">Message</label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                required
                rows="5"
                placeholder="Tell us about your project..."
              ></textarea>
            </div>
            <button 
              type="submit" 
              className="btn btn-primary submit-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Sending...' : 'Send Message'}
            </button>
            {submitStatus === 'success' && (
              <div className="form-success">
                ✓ Message sent successfully! We'll get back to you soon.
              </div>
            )}
            {submitStatus === 'error' && (
              <div className="form-error">
                ✗ There was an error sending your message. Please try again or email us directly at thefetch.in@gmail.com
              </div>
            )}
          </form>
        </div>
      </div>
    </section>
  )
}

export default Contact

