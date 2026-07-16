import type { Component } from 'vue'

export interface User {
  name: string
  email: string
  avatar?: string | null
}

export interface NavItem {
  title: string
  href: string
  icon?: Component
  isActive?: boolean
}

export interface BreadcrumbItem {
  title: string
  href: string
}

export type AppVariant = 'sidebar' | 'header'
