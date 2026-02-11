import express from 'express';
import { auth } from '../middleware/auth.js';
import {
  createGroup,
  getAllGroups,
  getGroupById,
  updateGroup,
  deleteGroup,
  getMembers,
  inviteMembers,
  joinGroup,
  getInvitationPreview,
  toggleComments,
  addComment,
  getComments,
  deleteComment,
  getInvitationStats,
  blockUser,
  removeMember,
} from '../controllers/groupController.js';

const router = express.Router();

// Group CRUD
router.post('/', auth, createGroup);
router.get('/', auth, getAllGroups);
router.get('/:id', auth, getGroupById);
router.put('/:id', auth, updateGroup);
router.delete('/:id', auth, deleteGroup);

// Members
router.get('/:id/members', auth, getMembers);
router.post('/:id/invite', auth, inviteMembers);
router.post('/:groupId/block/:userId', auth, blockUser);
router.delete('/:groupId/members/:userId', auth, removeMember);

// Invitations
router.get('/invite/:token/preview', getInvitationPreview);
router.post('/invite/:token/join', auth, joinGroup);
router.get('/:id/invitations/stats', auth, getInvitationStats);

// Comments
router.post('/:id/comments/toggle', auth, toggleComments);
router.post('/:id/comments', auth, addComment);
router.get('/:id/comments', auth, getComments);
router.delete('/:id/comments/:commentId', auth, deleteComment);

export default router;
