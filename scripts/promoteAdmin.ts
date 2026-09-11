/**
 * One-off CLI bootstrap: makes an existing user the first admin. There's no
 * API route for this on purpose — an admin can appoint further admins once
 * one exists, but the *first* one has nowhere to get that role from except
 * someone with direct database access running this.
 *
 * Usage (from backend/):
 *   npx tsx scripts/promoteAdmin.ts <username-or-email>
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import connectDB from '../src/config/db.js'
import User from '../src/models/User.js'

const identifier = process.argv[2]

if (!identifier) {
  console.error('Usage: npx tsx scripts/promoteAdmin.ts <username-or-email>')
  process.exit(1)
}

const run = async () => {
  await connectDB()

  const user = await User.findOne({
    $or: [{ username: identifier }, { email: identifier.toLowerCase() }],
  })

  if (!user) {
    console.error(`No user found for "${identifier}"`)
    process.exit(1)
  }

  if (user.role === 'ADMIN') {
    console.log(`${user.username} is already an admin.`)
  } else {
    user.role = 'ADMIN'
    await user.save()
    console.log(`${user.username} (${user.email}) is now an admin.`)
    console.log(
      'Sign in normally, then turn on 2FA from Account settings — it only becomes required once it\'s actually set up.',
    )
  }

  await mongoose.disconnect()
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
