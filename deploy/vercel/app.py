"""Vercel entry point (Flask zero-config): the demo app, answering its public Vercel domains."""
from demo.server import app, configure_public_hosts

configure_public_hosts()
