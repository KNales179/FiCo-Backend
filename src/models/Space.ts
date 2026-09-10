import mongoose, { Document, Schema } from 'mongoose'

export type SpaceType = 'PERSONAL' | 'FAMILY'

export interface ISpace extends Document {
  name: string
  type: SpaceType
  ownerId: mongoose.Types.ObjectId
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const spaceSchema = new Schema<ISpace>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 60,
    },

    type: {
      type: String,
      enum: ['PERSONAL', 'FAMILY'],
      required: true,
    },

    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

const Space = mongoose.model<ISpace>('Space', spaceSchema)

export default Space
