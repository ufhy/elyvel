import { describe, expect, test } from 'bun:test'
import { runSeeders, Seeder } from '../src/index'

describe('Seeder', () => {
  test('runSeeders runs each seeder in order', async () => {
    const order: string[] = []
    class First extends Seeder {
      override run() {
        order.push('first')
      }
    }
    class Second extends Seeder {
      override run() {
        order.push('second')
      }
    }

    await runSeeders([First, Second])
    expect(order).toEqual(['first', 'second'])
  })

  test('a seeder can call another via this.call', async () => {
    const order: string[] = []
    class Child extends Seeder {
      override run() {
        order.push('child')
      }
    }
    class Parent extends Seeder {
      override async run() {
        order.push('parent')
        await this.call(Child)
      }
    }

    await runSeeders([Parent])
    expect(order).toEqual(['parent', 'child'])
  })
})
